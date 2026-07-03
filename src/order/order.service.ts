import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../product/entities/product.entity';
import { ProductVariant } from '../product/entities/product-variant.entity'; // 🔥 Import Variant
import { User } from '../user/entities/user.entity';
import { UserAddress } from '../user/entities/user-address.entity';
import { CheckoutCartDto, CheckoutDirectDto, CreateCheckoutDto } from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class OrderService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(Cart) private cartRepo: Repository<Cart>,
        @InjectRepository(Product) private productRepo: Repository<Product>,
        @InjectRepository(ProductVariant) private variantRepo: Repository<ProductVariant>, // 🔥 Inject Variant Repo
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(UserAddress) private addressRepo: Repository<UserAddress>,
        private readonly paymentService: PaymentService,
    ) {}

    // ====================== GENERATOR INVOICE ======================
    private generateInvoiceNumber(): string {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        return `INV-${dateStr}-${randomNum}`;
    }

    // ====================== CHECKOUT VIA CART ======================
    async checkoutFromCart(userId: string, dto: CheckoutCartDto) {
        const cartItems = await this.cartRepo.find({
            where: { 
                id: In(dto.cart_ids),
                user_id: userId 
            },
            relations: ['product', 'product.variants'], // 🔥 Load relasi variants
        });

        if (cartItems.length === 0) {
            throw new BadRequestException('Item keranjang tidak ditemukan atau sudah dihapus.');
        }

        let totalPrice = 0;
        const orderItems: Partial<OrderItem>[] = [];

        for (const cart of cartItems) {
            if (!cart.product) continue;

            // 🔥 Cari variasi yang dipilih user
            let matchedVariant = cart.product.variants?.find(
                (v) => v.variant_name === cart.selected_variasi
            );

            // Kalau gak nemu, pakai variasi default
            if (!matchedVariant && cart.product.variants?.length > 0) {
                matchedVariant = cart.product.variants[0];
            }

            if (!matchedVariant) {
                throw new BadRequestException(`Data variasi produk ${cart.product.name} tidak valid.`);
            }

            if (matchedVariant.stock < cart.quantity) {
                throw new BadRequestException(`Stok produk ${cart.product.name} (${matchedVariant.variant_name}) tidak mencukupi.`);
            }

            const priceNormal = Number(matchedVariant.price_normal || 0);
            const priceDiscount = Number(matchedVariant.price_discount || 0);
            const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;

            totalPrice += finalPrice * cart.quantity;

            orderItems.push({
                product: { id: cart.product.id } as Product,
                product_name: cart.product.name,
                variasi: matchedVariant.variant_name, // Simpan nama variasi fix
                quantity: cart.quantity,
                price: finalPrice,
            });
        }

        const newOrder = this.orderRepo.create({
            user: { id: userId },
            invoice_number: this.generateInvoiceNumber(),
            total_price: totalPrice,
            notes: dto.notes,
            items: orderItems as OrderItem[], 
        });

        const savedOrder = await this.orderRepo.save(newOrder);
        await this.cartRepo.delete(dto.cart_ids);

        return {
            message: 'Checkout keranjang berhasil',
            order: savedOrder,
        };
    }

    // ====================== CHECKOUT BELI LANGSUNG ======================
    async checkoutDirect(userId: string, dto: CheckoutDirectDto) {
        const product = await this.productRepo.findOne({ 
            where: { id: dto.product_id },
            relations: ['variants'] // 🔥 Load relasi variants
        });

        if (!product) {
            throw new NotFoundException('Produk tidak ditemukan');
        }

        // 🔥 Cari variasi yang dipilih user
        let matchedVariant = product.variants?.find(
            (v) => v.variant_name === dto.variasi
        );

        if (!matchedVariant && product.variants?.length > 0) {
            matchedVariant = product.variants[0];
        }

        if (!matchedVariant) {
            throw new BadRequestException(`Data variasi produk tidak valid.`);
        }

        if (matchedVariant.stock < dto.quantity) {
            throw new BadRequestException(`Stok produk ${product.name} (${matchedVariant.variant_name}) hanya tersisa ${matchedVariant.stock}`);
        }

        const priceNormal = Number(matchedVariant.price_normal || 0);
        const priceDiscount = Number(matchedVariant.price_discount || 0);
        const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;

        const totalPrice = finalPrice * dto.quantity;

        const orderItem: Partial<OrderItem> = {
            product: { id: product.id } as Product,
            product_name: product.name,
            variasi: matchedVariant.variant_name,
            quantity: dto.quantity,
            price: finalPrice,
        };

        const newOrder = this.orderRepo.create({
            user: { id: userId },
            invoice_number: this.generateInvoiceNumber(),
            total_price: totalPrice,
            notes: dto.notes,
            items: [orderItem as OrderItem],
        });

        const savedOrder = await this.orderRepo.save(newOrder);

        return {
            message: 'Checkout langsung berhasil',
            order: savedOrder,
        };
    }

    // ====================== RIWAYAT PESANAN USER ======================
    async findMyOrders(userId: string) {
        const orders = await this.orderRepo.find({
            where: { user: { id: userId } },
            relations: ['items', 'items.product', 'items.product.images'], 
            order: { created_at: 'DESC' },
        });

        return orders.map((order) => {
            return {
                ...order,
                items: order.items.map((item) => {
                    let thumbnail: string | null = null;
                    if (item.product && item.product.images && item.product.images.length > 0) {
                        const mainImage = item.product.images.find((img) => img.sort_order === 0) || item.product.images[0];
                        thumbnail = mainImage.thumbnail_url || null; 
                    }

                    return {
                        ...item,
                        product: item.product ? {
                            ...item.product,
                            thumbnail: thumbnail, 
                        } : null,
                    };
                }),
            };
        });
    }

    // ====================== USER BATALKAN PESANAN ======================
  async retryPayment(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user: { id: userId } },
      relations: ['user'],
    });

    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING') {
      throw new BadRequestException('Hanya pesanan PENDING yang bisa dibayar ulang');
    }

    const user = order.user;

    // Generate new invoice number agar Midtrans tidak reject (order_id must be unique)
    const invDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const invNum = Math.floor(1000 + Math.random() * 9000);
    const retryInvoice = `${order.invoice_number}-R${invDate}-${invNum}`;

    // Update invoice_number di database agar webhook Midtrans bisa menemukan order ini
    order.invoice_number = retryInvoice;
    await this.orderRepo.save(order);

    const transaction = await this.paymentService.createTransaction(
      retryInvoice,
      order.total_price,
      {
        first_name: user.full_name || 'Customer',
        email: user.email,
        phone: user.phone_number || '',
      },
    );

    return {
      message: 'Token pembayaran berhasil dibuat',
      payment: {
        token: transaction.token,
        redirect_url: transaction.redirect_url,
      },
    };
  }

  async checkPaymentStatus(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user: { id: userId } },
    });

    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING') {
      return { message: `Status pesanan sudah ${order.status}`, status: order.status };
    }

    // Query Midtrans API langsung
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const baseUrl = isProduction 
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';

    try {
      const auth = Buffer.from(`${serverKey}:`).toString('base64');
      const response = await fetch(`${baseUrl}/${order.invoice_number}/status`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error_messages?.[0] || 'Failed to check status');
      }

      const transactionStatus = data.transaction_status;
      const fraudStatus = data.fraud_status;

      let newStatus: string = order.status;

      if (transactionStatus === 'capture' && fraudStatus === 'accept') {
        newStatus = 'LUNAS';
      } else if (transactionStatus === 'settlement') {
        newStatus = 'LUNAS';
      } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
        newStatus = 'BATAL';
      } else if (transactionStatus === 'pending') {
        newStatus = 'PENDING';
      }

      if (order.status !== newStatus) {
        order.status = newStatus;
        await this.orderRepo.save(order);
        return { message: `Status diperbarui: ${order.status} → ${newStatus}`, status: newStatus };
      }

      return { message: `Status masih ${order.status}`, status: order.status };
    } catch (err: any) {
      throw new BadRequestException(`Gagal mengecek status: ${err.message}`);
    }
  }

  async cancelOrderUser(userId: string, orderId: string) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId, user: { id: userId } },
        });

        if (!order) {
            throw new NotFoundException('Pesanan tidak ditemukan atau bukan milik Anda.');
        }

        if (order.status !== 'PENDING') {
            throw new BadRequestException('Hanya pesanan berstatus PENDING yang dapat dibatalkan.');
        }

        order.status = 'BATAL';
        const updatedOrder = await this.orderRepo.save(order);

        return {
            message: 'Pesanan berhasil dibatalkan',
            order: updatedOrder,
        };
    }

    // ====================== UPDATE STATUS OLEH ADMIN ======================
    async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['items', 'items.product', 'items.product.variants'], // 🔥 Load relasi variants
        });

        if (!order) {
            throw new NotFoundException('Pesanan tidak ditemukan');
        }

        // 🔥 Logika Kurangi Stok
        if (order.status === 'PENDING' && dto.status === 'LUNAS') {
            for (const item of order.items) {
                if (item.product) {
                    let matchedVariant = item.product.variants?.find(
                        (v) => v.variant_name === item.variasi
                    );
                    if (!matchedVariant && item.product.variants?.length > 0) {
                        matchedVariant = item.product.variants[0];
                    }

                    if (matchedVariant) {
                        if (matchedVariant.stock < item.quantity) {
                            throw new BadRequestException(`Gagal: Stok produk ${item.product.name} (${matchedVariant.variant_name}) tidak mencukupi untuk pesanan ini.`);
                        }
                        matchedVariant.stock -= item.quantity;
                        await this.variantRepo.save(matchedVariant); // 🔥 Save perubahan stok di variant
                    }
                }
            }
        }

        // 🔥 Logika Kembalikan Stok
        if (order.status === 'LUNAS' && dto.status === 'BATAL') {
            for (const item of order.items) {
                if (item.product) {
                    let matchedVariant = item.product.variants?.find(
                        (v) => v.variant_name === item.variasi
                    );
                    if (!matchedVariant && item.product.variants?.length > 0) {
                        matchedVariant = item.product.variants[0];
                    }

                    if (matchedVariant) {
                        matchedVariant.stock += item.quantity;
                        await this.variantRepo.save(matchedVariant); // 🔥 Save pengembalian stok di variant
                    }
                }
            }
        }

        order.status = dto.status;
        const updatedOrder = await this.orderRepo.save(order);

        return {
            message: `Status pesanan berhasil diubah menjadi ${dto.status}`,
            order: updatedOrder,
        };
    }

    async findAllOrders(query: any) {
        const qb = this.orderRepo.createQueryBuilder('order')
            .leftJoinAndSelect('order.user', 'user')
            .leftJoinAndSelect('order.items', 'items')
            .leftJoinAndSelect('user.addresses', 'addresses')
            .leftJoinAndSelect('items.product', 'product') 
            .leftJoinAndSelect('product.images', 'images') 
            .orderBy('order.created_at', 'DESC');

        if (query.status) {
            qb.andWhere('order.status = :status', { status: query.status });
        }

        const [data, total] = await qb.getManyAndCount();

        const mappedData = data.map((order) => {
            order.items = order.items.map((item) => {
                let thumbnail: string | null = null;
                if (item.product && item.product.images && item.product.images.length > 0) {
                    const mainImage = item.product.images.find((img) => img.sort_order === 0) || item.product.images[0];
                    thumbnail = mainImage.thumbnail_url || null;
                }
                if (item.product) {
                    (item.product as any).thumbnail = thumbnail;
                }
                return item;
            });
            return order;
        });

        return { data: mappedData, total };
    }

    async findOneOrder(id: string) {
        const order = await this.orderRepo.findOne({
            where: { id },
            relations: ['user', 'user.addresses', 'items', 'items.product', 'items.product.images'], 
        });

        if (!order) {
            throw new NotFoundException(`Pesanan dengan ID ${id} tidak ditemukan`);
        }

        order.items = order.items.map((item) => {
            let thumbnail: string | null = null;
            if (item.product && item.product.images && item.product.images.length > 0) {
                const mainImage = item.product.images.find((img) => img.sort_order === 0) || item.product.images[0];
                thumbnail = mainImage.thumbnail_url || null;
            }
            if (item.product) {
                (item.product as any).thumbnail = thumbnail;
            }
            return item;
        });

        return order;
    }

    // ====================== CHECKOUT PC BUILDER ======================
    async checkoutPCBuilder(userId: string, dto: { items: { product_id: string, quantity: number }[], notes?: string }) {
        if (!dto.items || dto.items.length === 0) {
            throw new BadRequestException('Komponen rakitan tidak boleh kosong');
        }

        let totalPrice = 0;
        const orderItems: Partial<OrderItem>[] = [];

        for (const item of dto.items) {
            const product = await this.productRepo.findOne({ 
                where: { id: item.product_id },
                relations: ['variants'] // 🔥 Load relasi variants
            });

            if (!product) {
                throw new NotFoundException(`Produk dengan ID ${item.product_id} tidak ditemukan`);
            }

            // PC Builder biasanya tanpa variasi, jadi kita pakai variasi default (index 0)
            const matchedVariant = product.variants && product.variants.length > 0 ? product.variants[0] : null;

            if (!matchedVariant) {
                throw new BadRequestException(`Data variasi produk ${product.name} tidak valid.`);
            }

            if (matchedVariant.stock < item.quantity) {
                throw new BadRequestException(`Stok produk ${product.name} tidak mencukupi. Tersisa ${matchedVariant.stock}`);
            }

            const priceNormal = Number(matchedVariant.price_normal || 0);
            const priceDiscount = Number(matchedVariant.price_discount || 0);
            const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;

            totalPrice += finalPrice * item.quantity;

            orderItems.push({
                product: { id: product.id } as Product,
                product_name: product.name,
                variasi: "Default", // Atau matchedVariant.variant_name
                quantity: item.quantity,
                price: finalPrice,
            });
        }

        const newOrder = this.orderRepo.create({
            user: { id: userId },
            invoice_number: this.generateInvoiceNumber(),
            total_price: totalPrice,
            notes: dto.notes,
            items: orderItems as OrderItem[],
        });

        const savedOrder = await this.orderRepo.save(newOrder);

        return {
            message: 'Checkout Rakitan PC berhasil',
            order: savedOrder,
        };
    }

    // ====================== CHECKOUT + MIDTRANS PAYMENT ======================
    async createCheckout(userId: string, dto: CreateCheckoutDto) {
        // 1. Fetch user data for Midtrans customer_details
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
            throw new NotFoundException('User tidak ditemukan');
        }

        let totalPrice = 0;
        const orderItems: Partial<OrderItem>[] = [];

        // 2. Process cart-based checkout
        if (dto.cart_ids && dto.cart_ids.length > 0) {
            const cartItems = await this.cartRepo.find({
                where: {
                    id: In(dto.cart_ids),
                    user_id: userId,
                },
                relations: ['product', 'product.variants'],
            });

            if (cartItems.length === 0) {
                throw new BadRequestException('Item keranjang tidak ditemukan atau sudah dihapus.');
            }

            for (const cart of cartItems) {
                if (!cart.product) continue;

                let matchedVariant = cart.product.variants?.find(
                    (v) => v.variant_name === cart.selected_variasi,
                );
                if (!matchedVariant && cart.product.variants?.length > 0) {
                    matchedVariant = cart.product.variants[0];
                }
                if (!matchedVariant) {
                    throw new BadRequestException(`Data variasi produk ${cart.product.name} tidak valid.`);
                }
                if (matchedVariant.stock < cart.quantity) {
                    throw new BadRequestException(`Stok produk ${cart.product.name} (${matchedVariant.variant_name}) tidak mencukupi.`);
                }

                const priceNormal = Number(matchedVariant.price_normal || 0);
                const priceDiscount = Number(matchedVariant.price_discount || 0);
                const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;

                totalPrice += finalPrice * cart.quantity;

                orderItems.push({
                    product: { id: cart.product.id } as Product,
                    product_name: cart.product.name,
                    variasi: matchedVariant.variant_name,
                    quantity: cart.quantity,
                    price: finalPrice,
                });
            }

            // Cart will be deleted AFTER successful Midtrans transaction (see step 7)
        }

        // 3. Process direct buy checkout (single product)
        if (dto.direct_item) {
            const directItem = dto.direct_item;
            const product = await this.productRepo.findOne({
                where: { id: directItem.product_id },
                relations: ['variants'],
            });

            if (!product) {
                throw new NotFoundException('Produk tidak ditemukan');
            }

            let matchedVariant = product.variants?.find(
                (v) => v.variant_name === directItem.variasi,
            );
            if (!matchedVariant && product.variants?.length > 0) {
                matchedVariant = product.variants[0];
            }
            if (!matchedVariant) {
                throw new BadRequestException(`Data variasi produk ${product.name} tidak valid.`);
            }
            if (matchedVariant.stock < directItem.quantity) {
                throw new BadRequestException(`Stok produk ${product.name} (${matchedVariant.variant_name}) hanya tersisa ${matchedVariant.stock}`);
            }

            const priceNormal = Number(matchedVariant.price_normal || 0);
            const priceDiscount = Number(matchedVariant.price_discount || 0);
            const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;

            const itemTotal = finalPrice * directItem.quantity;
            totalPrice += itemTotal;

            orderItems.push({
                product: { id: product.id } as Product,
                product_name: product.name,
                variasi: matchedVariant.variant_name,
                quantity: directItem.quantity,
                price: finalPrice,
            });
        }

        if (orderItems.length === 0) {
            throw new BadRequestException('Tidak ada item yang bisa diproses. Kirim cart_ids atau direct_item.');
        }

        // 4. Calculate grossAmount (items total + shipping cost)
        const shippingCost = dto.shipping_cost || 0;
        const grossAmount = totalPrice + shippingCost;
        const invoiceNumber = this.generateInvoiceNumber();

        // 5. Save order to database with PENDING status
        const newOrder = this.orderRepo.create({
            user: { id: userId },
            invoice_number: invoiceNumber,
            total_price: grossAmount,
            status: 'PENDING',
            notes: dto.notes,
            items: orderItems as OrderItem[],
        });

        const savedOrder = await this.orderRepo.save(newOrder);

        // 6. Build customer_details for Midtrans
        const customerDetails: any = {
            first_name: user.full_name || 'Customer',
            email: user.email,
            phone: user.phone_number || '',
        };

        // Fetch selected address if address_id is provided
        if (dto.address_id) {
            const address = await this.addressRepo.findOne({
                where: { id: dto.address_id, user: { id: userId } },
            });
            if (address) {
                customerDetails.shipping_address = {
                    first_name: address.recipient_name || user.full_name,
                    phone: address.phone_number || user.phone_number,
                    address: address.full_address,
                };
            }
        }

        // 7. Generate Midtrans payment token
        const transaction = await this.paymentService.createTransaction(
            invoiceNumber, // orderId for Midtrans
            grossAmount,
            customerDetails,
        );

        // 7b. NOW delete cart items — only after successful transaction
        if (dto.cart_ids && dto.cart_ids.length > 0) {
            await this.cartRepo.delete(dto.cart_ids);
        }

        // 8. Return order data + Midtrans token & redirect_url
        return {
            message: 'Checkout berhasil, silakan lanjutkan pembayaran',
            order: savedOrder,
            payment: {
                token: transaction.token,
                redirect_url: transaction.redirect_url,
            },
        };
    }
}
