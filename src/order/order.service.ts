import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../product/entities/product.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { User } from '../user/entities/user.entity';
import { UserAddress } from '../user/entities/user-address.entity';
import {
  CheckoutCartDto,
  CheckoutDirectDto,
  CreateCheckoutDto,
} from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Cart) private cartRepo: Repository<Cart>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(ProductVariant)
    private variantRepo: Repository<ProductVariant>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UserAddress) private addressRepo: Repository<UserAddress>,
    private readonly paymentService: PaymentService,
  ) {}

  private generateInvoiceNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `INV-${dateStr}-${randomNum}`;
  }

  async deductStock(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) return;
    for (const item of order.items) {
      if (!item.product) continue;
      let matchedVariant = item.product.variants?.find(
        (v) => v.variant_name === item.variasi,
      );
      if (!matchedVariant && item.product.variants?.length > 0)
        matchedVariant = item.product.variants[0];
      if (matchedVariant) {
        if (matchedVariant.stock < item.quantity)
          throw new BadRequestException(
            `Stok produk ${item.product.name} (${matchedVariant.variant_name}) tidak mencukupi.`,
          );
        matchedVariant.stock -= item.quantity;
        await this.variantRepo.save(matchedVariant);
      }
    }
  }

  async restoreStock(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) return;
    for (const item of order.items) {
      if (!item.product) continue;
      let matchedVariant = item.product.variants?.find(
        (v) => v.variant_name === item.variasi,
      );
      if (!matchedVariant && item.product.variants?.length > 0)
        matchedVariant = item.product.variants[0];
      if (matchedVariant) {
        matchedVariant.stock += item.quantity;
        await this.variantRepo.save(matchedVariant);
      }
    }
  }

  async checkoutFromCart(userId: string, dto: CheckoutCartDto) {
    const cartItems = await this.cartRepo.find({
      where: { id: In(dto.cart_ids), user_id: userId },
      relations: ['product', 'product.variants'],
    });
    if (cartItems.length === 0)
      throw new BadRequestException('Item keranjang tidak ditemukan.');

    let totalPrice = 0;
    const orderItems: Partial<OrderItem>[] = [];
    for (const cart of cartItems) {
      if (!cart.product) continue;
      let mv = cart.product.variants?.find(
        (v) => v.variant_name === cart.selected_variasi,
      );
      if (!mv && cart.product.variants?.length > 0)
        mv = cart.product.variants[0];
      if (!mv)
        throw new BadRequestException(
          `Data variasi produk ${cart.product.name} tidak valid.`,
        );
      if (mv.stock < cart.quantity)
        throw new BadRequestException(
          `Stok ${cart.product.name} (${mv.variant_name}) tidak mencukupi.`,
        );
      const pn = Number(mv.price_normal || 0);
      const pd = Number(mv.price_discount || 0);
      const fp = pd > 0 ? pn - pd : pn;
      totalPrice += fp * cart.quantity;
      orderItems.push({
        product: { id: cart.product.id } as Product,
        product_name: cart.product.name,
        variasi: mv.variant_name,
        quantity: cart.quantity,
        price: fp,
      });
    }

    const newOrder = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: totalPrice,
      notes: dto.notes,
      items: orderItems as OrderItem[],
    } as any);
    const savedOrder = await this.orderRepo.save(newOrder);
    await this.cartRepo.delete(dto.cart_ids);
    return { message: 'Checkout keranjang berhasil', order: savedOrder };
  }

  async checkoutDirect(userId: string, dto: CheckoutDirectDto) {
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id },
      relations: ['variants'],
    });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    let mv = product.variants?.find((v) => v.variant_name === dto.variasi);
    if (!mv && product.variants?.length > 0) mv = product.variants[0];
    if (!mv) throw new BadRequestException('Data variasi produk tidak valid.');
    if (mv.stock < dto.quantity)
      throw new BadRequestException(
        `Stok ${product.name} (${mv.variant_name}) hanya tersisa ${mv.stock}`,
      );
    const fp =
      Number(mv.price_discount || 0) > 0
        ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
        : Number(mv.price_normal || 0);
    const newOrder = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: fp * dto.quantity,
      notes: dto.notes,
      items: [
        {
          product: { id: product.id } as Product,
          product_name: product.name,
          variasi: mv.variant_name,
          quantity: dto.quantity,
          price: fp,
        } as OrderItem,
      ],
    } as any);
    const savedOrder = await this.orderRepo.save(newOrder);
    return { message: 'Checkout langsung berhasil', order: savedOrder };
  }

  async findMyOrders(userId: string) {
    return this.orderRepo.find({
      where: { user_id: userId } as any,
      relations: ['items', 'items.product', 'items.product.images'],
      order: { created_at: 'DESC' },
    });
  }

  async retryPayment(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
      relations: ['user'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING')
      throw new BadRequestException(
        'Hanya pesanan PENDING yang bisa dibayar ulang',
      );
    const tx = await this.paymentService.createTransaction(
      `${order.invoice_number}-R${order.id.slice(0, 8)}`,
      order.total_price,
      {
        first_name: order.user.full_name || 'Customer',
        email: order.user.email,
        phone: order.user.phone_number || '',
      },
    );
    return {
      message: 'Token pembayaran berhasil dibuat',
      payment: { token: tx.token, redirect_url: tx.redirect_url },
    };
  }

  async checkPaymentStatus(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING')
      return {
        message: `Status pesanan sudah ${order.status}`,
        status: order.status,
      };
    const sk = process.env.MIDTRANS_SERVER_KEY || '';
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const base = isProd
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';
    const auth = Buffer.from(`${sk}:`).toString('base64');
    const res = await fetch(`${base}/${order.invoice_number}/status`, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    if (!res.ok)
      throw new BadRequestException(data.error_messages?.[0] || 'Failed check');
    const ts = data.transaction_status,
      fs = data.fraud_status;
    let ns = order.status;
    if (ts === 'capture' && fs === 'accept') ns = 'LUNAS';
    else if (ts === 'settlement') ns = 'LUNAS';
    else if (['cancel', 'deny', 'expire'].includes(ts)) ns = 'BATAL';
    else if (ts === 'pending') ns = 'PENDING';
    if (order.status !== ns) {
      order.status = ns;
      await this.orderRepo.save(order);
      return { message: `Status: → ${ns}`, status: ns };
    }
    return { message: `Status masih ${order.status}`, status: order.status };
  }

  async getTrackingInfo(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (!order.tracking_number)
      return {
        message: 'Nomor resi belum tersedia',
        tracking_number: null,
        status: order.status,
        courier_name: order.courier_name,
        courier_service: order.courier_service,
        history: [],
      };
    try {
      const key = process.env.BITESHIP_API_KEY || '';
      const res = await fetch(
        `https://api.biteship.com/v1/trackings/${order.tracking_number}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const data = await res.json();
      if (!res.ok)
        return {
          message: 'Data tracking tidak tersedia',
          tracking_number: order.tracking_number,
          status: order.status,
          courier_name: order.courier_name,
          courier_service: order.courier_service,
          history: [],
          raw_error: data.message,
        };
      return {
        message: 'Data tracking berhasil diambil',
        tracking_number: order.tracking_number,
        status: data.status || order.status,
        courier_name: order.courier_name || data.courier?.name,
        courier_service: order.courier_service,
        history: (data.history || []).map((e: any) => ({
          status: e.status,
          note: e.note,
          updated_at: e.updated_at,
          location: e.location || null,
        })),
        waybill_url: data.waybill_url || null,
      };
    } catch (err: any) {
      return {
        message: 'Gagal mengambil data tracking',
        tracking_number: order.tracking_number,
        status: order.status,
        courier_name: order.courier_name,
        courier_service: order.courier_service,
        history: [],
        error: err.message,
      };
    }
  }

  async cancelOrderUser(userId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.is_locked)
      throw new BadRequestException(
        'Pesanan sudah diproses admin, tidak dapat dibatalkan.',
      );
    if (order.status !== 'PENDING')
      throw new BadRequestException(
        'Hanya pesanan PENDING yang dapat dibatalkan.',
      );
    order.status = 'BATAL';
    return {
      message: 'Pesanan berhasil dibatalkan',
      order: await this.orderRepo.save(order),
    };
  }

  async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status === 'PENDING' && dto.status === 'LUNAS')
      await this.deductStock(orderId);
    if (order.status === 'LUNAS' && dto.status === 'BATAL')
      await this.restoreStock(orderId);
    if (dto.status === 'DIKIRIM') order.delivered_at = new Date();
    if (dto.status === 'SELESAI') order.completed_at = new Date();
    order.status = dto.status as string;
    if (dto.tracking_number !== undefined)
      order.tracking_number = dto.tracking_number;
    if (dto.courier_name !== undefined) order.courier_name = dto.courier_name;
    if (dto.courier_service !== undefined)
      order.courier_service = dto.courier_service;
    if (dto.awb_number !== undefined) order.awb_number = dto.awb_number;
    if (dto.awb_url !== undefined) order.awb_url = dto.awb_url;
    return {
      message: `Status diubah menjadi ${dto.status}`,
      order: await this.orderRepo.save(order),
    };
  }

  async processOrder(
    orderId: string,
    dto?: {
      tracking_number?: string;
      courier_name?: string;
      courier_service?: string;
    },
  ) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'LUNAS')
      throw new BadRequestException('Hanya pesanan LUNAS yang bisa diproses.');
    order.is_locked = true;
    order.status = 'DIKEMAS';
    if (dto?.tracking_number) order.tracking_number = dto.tracking_number;
    if (dto?.courier_name) order.courier_name = dto.courier_name;
    if (dto?.courier_service) order.courier_service = dto.courier_service;
    await this.deductStock(orderId);
    if (order.shipping_type === 'regular' && order.courier_name) {
      try {
        const awb = await this.generateAwb(order);
        if (awb) {
          (order as any).awb_number = awb.awb_number;
          (order as any).awb_url = awb.awb_url;
          if (!order.tracking_number)
            (order as any).tracking_number = awb.awb_number;
        }
      } catch (e: any) {
        console.error('AWB error:', e.message);
      }
    }
    return {
      message: 'Pesanan diproses dan dikunci.',
      order: await this.orderRepo.save(order),
    };
  }

  private async generateAwb(
    order: Order,
  ): Promise<{ awb_number: string; awb_url: string } | null> {
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key) return null;
    let da = '',
      dpc = '',
      did = '';
    if (order.address_id) {
      const addr = await this.addressRepo.findOne({
        where: { id: order.address_id } as any,
      });
      if (addr) {
        da = addr.full_address || '';
        dpc = addr.postal_code || '';
        did = addr.area_id || '';
      }
    }
    const body: any = {
      origin_contact_name: process.env.STORE_CONTACT_NAME || 'Anandam Store',
      origin_contact_phone: process.env.STORE_PHONE || '08123456789',
      origin_address:
        process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Yogyakarta',
      origin_postal_code: process.env.STORE_POSTAL_CODE || '55283',
      destination_contact_name: order.user?.full_name || 'Customer',
      destination_contact_phone: order.user?.phone_number || '',
      destination_address: da,
      destination_postal_code: dpc,
      courier_company: order.courier_name || 'jne',
      courier_type: order.courier_service || 'reg',
      delivery_type: 'later',
      items: order.items.map((i) => ({
        name: i.product_name,
        value: Number(i.price),
        quantity: i.quantity,
        weight: 1000,
      })),
    };
    if (process.env.STORE_AREA_ID)
      body.origin_area_id = process.env.STORE_AREA_ID;
    if (did) body.destination_area_id = did;
    try {
      const res = await fetch('https://api.biteship.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Biteship AWB error:', data);
        return null;
      }
      return {
        awb_number: data.waybill_id || data.id || '',
        awb_url: data.waybill_url || data.courier?.waybill_url || '',
      };
    } catch (e: any) {
      console.error('Biteship AWB ex:', e.message);
      return null;
    }
  }

  async requestPickup(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException(
        'Hanya pesanan DIKEMAS yang bisa minta pickup.',
      );
    if (order.shipping_type === 'instant')
      throw new BadRequestException('Gunakan "Cari Driver" untuk instant.');
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key)
      throw new BadRequestException('API Key Biteship belum dikonfigurasi.');
    try {
      const res = await fetch('https://api.biteship.com/v1/pickups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_id:
            order.awb_number || order.tracking_number || order.invoice_number,
          courier_company: order.courier_name || 'jne',
          pickup_date: new Date(Date.now() + 86400000)
            .toISOString()
            .slice(0, 10),
          pickup_time_zone: 'Asia/Jakarta',
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || data.message || 'Gagal request pickup');
      order.pickup_request_id = data.id || data.pickup_id || null;
      await this.orderRepo.save(order);
      return { message: 'Request pickup berhasil.', pickup: data };
    } catch (err: any) {
      throw new BadRequestException(`Gagal request pickup: ${err.message}`);
    }
  }

  async searchDriver(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException(
        'Hanya pesanan DIKEMAS yang bisa cari driver.',
      );
    if (order.shipping_type !== 'instant')
      throw new BadRequestException('Fitur ini hanya untuk instant.');
    let dl = '',
      dlg = '';
    if (order.address_id) {
      const addr = await this.addressRepo.findOne({
        where: { id: order.address_id } as any,
      });
      if (addr?.latitude && addr?.longitude) {
        dl = String(addr.latitude);
        dlg = String(addr.longitude);
      }
    }
    if (!dl || !dlg)
      throw new BadRequestException('Alamat tujuan tidak memiliki koordinat.');
    const key = process.env.BITESHIP_API_KEY || '';
    try {
      const items = order.items.map((i) => ({
        name: i.product_name,
        value: Number(i.price),
        quantity: i.quantity,
        weight: 1000,
      }));
      const res = await fetch('https://api.biteship.com/v1/rates/couriers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin_latitude: Number(process.env.STORE_LATITUDE || '-7.8300'),
          origin_longitude: Number(process.env.STORE_LONGITUDE || '110.3870'),
          destination_latitude: Number(dl),
          destination_longitude: Number(dlg),
          couriers: order.courier_name || 'gosend,grabexpress',
          items: items.map((i) => ({ ...i, weight: i.weight / 1000 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Gagal');
      if (!data.pricing?.length)
        return {
          message: 'Tidak ada driver tersedia.',
          driver_found: false,
          rates: [],
        };
      order.tracking_number = `INSTANT-${order.invoice_number}`;
      await this.orderRepo.save(order);
      return {
        message: 'Driver tersedia.',
        driver_found: true,
        rates: data.pricing,
      };
    } catch (err: any) {
      throw new BadRequestException(`Gagal cari driver: ${err.message}`);
    }
  }

  async markDelivered(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException('Hanya pesanan DIKEMAS.');
    order.status = 'DIKIRIM';
    order.delivered_at = new Date();
    return {
      message: 'Pesanan dikirim.',
      order: await this.orderRepo.save(order),
    };
  }

  async confirmReceived(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKIRIM')
      throw new BadRequestException('Hanya pesanan DIKIRIM.');
    order.status = 'SELESAI';
    order.completed_at = new Date();
    return {
      message: 'Pesanan diterima. Terima kasih!',
      order: await this.orderRepo.save(order),
    };
  }

  async autoCompleteOrders(): Promise<number> {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const orders = await this.orderRepo.find({
      where: {
        status: 'DIKIRIM' as any,
        delivered_at: LessThan(twoDaysAgo) as any,
      },
    });
    for (const o of orders) {
      o.status = 'SELESAI';
      o.completed_at = new Date();
    }
    if (orders.length > 0) await this.orderRepo.save(orders);
    return orders.length;
  }

  async findAllOrders(query: any) {
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('user.addresses', 'addresses')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('product.images', 'images')
      .orderBy('order.created_at', 'DESC');
    if (query.status)
      qb.andWhere('order.status = :status', { status: query.status });
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOneOrder(id: string) {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: [
        'user',
        'user.addresses',
        'items',
        'items.product',
        'items.product.images',
      ],
    });
    if (!order) throw new NotFoundException(`Pesanan ${id} tidak ditemukan`);
    return order;
  }

  async checkoutPCBuilder(
    userId: string,
    dto: { items: { product_id: string; quantity: number }[]; notes?: string },
  ) {
    if (!dto.items?.length)
      throw new BadRequestException('Komponen tidak boleh kosong');
    let tp = 0;
    const oi: Partial<OrderItem>[] = [];
    for (const item of dto.items) {
      const product = await this.productRepo.findOne({
        where: { id: item.product_id },
        relations: ['variants'],
      });
      if (!product)
        throw new NotFoundException(
          `Produk ${item.product_id} tidak ditemukan`,
        );
      const mv = product.variants?.length > 0 ? product.variants[0] : null;
      if (!mv)
        throw new BadRequestException(
          `Data variasi ${product.name} tidak valid.`,
        );
      if (mv.stock < item.quantity)
        throw new BadRequestException(`Stok ${product.name} tidak mencukupi.`);
      const fp =
        Number(mv.price_discount || 0) > 0
          ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
          : Number(mv.price_normal || 0);
      tp += fp * item.quantity;
      oi.push({
        product: { id: product.id } as Product,
        product_name: product.name,
        variasi: mv.variant_name,
        quantity: item.quantity,
        price: fp,
      });
    }
    const no = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: tp,
      notes: dto.notes,
      items: oi as OrderItem[],
    } as any);
    return {
      message: 'Checkout Rakitan PC berhasil',
      order: await this.orderRepo.save(no),
    };
  }

  async createCheckout(userId: string, dto: CreateCheckoutDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    let tp = 0;
    const oi: Partial<OrderItem>[] = [];

    if (dto.cart_ids?.length) {
      const cartItems = await this.cartRepo.find({
        where: { id: In(dto.cart_ids), user_id: userId },
        relations: ['product', 'product.variants'],
      });
      if (cartItems.length === 0)
        throw new BadRequestException('Item keranjang tidak ditemukan.');
      for (const cart of cartItems) {
        if (!cart.product) continue;
        let mv = cart.product.variants?.find(
          (v) => v.variant_name === cart.selected_variasi,
        );
        if (!mv && cart.product.variants?.length > 0)
          mv = cart.product.variants[0];
        if (!mv)
          throw new BadRequestException(
            `Data variasi ${cart.product.name} tidak valid.`,
          );
        if (mv.stock < cart.quantity)
          throw new BadRequestException(
            `Stok ${cart.product.name} tidak mencukupi.`,
          );
        const fp =
          Number(mv.price_discount || 0) > 0
            ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
            : Number(mv.price_normal || 0);
        tp += fp * cart.quantity;
        oi.push({
          product: { id: cart.product.id } as Product,
          product_name: cart.product.name,
          variasi: mv.variant_name,
          quantity: cart.quantity,
          price: fp,
        });
      }
    }

    if (dto.direct_item) {
      const di = dto.direct_item;
      const product = await this.productRepo.findOne({
        where: { id: di.product_id },
        relations: ['variants'],
      });
      if (!product) throw new NotFoundException('Produk tidak ditemukan');
      let mv = product.variants?.find((v) => v.variant_name === di.variasi);
      if (!mv && product.variants?.length > 0) mv = product.variants[0];
      if (!mv)
        throw new BadRequestException(
          `Data variasi ${product.name} tidak valid.`,
        );
      if (mv.stock < di.quantity)
        throw new BadRequestException(
          `Stok ${product.name} hanya tersisa ${mv.stock}`,
        );
      const fp =
        Number(mv.price_discount || 0) > 0
          ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
          : Number(mv.price_normal || 0);
      tp += fp * di.quantity;
      oi.push({
        product: { id: product.id } as Product,
        product_name: product.name,
        variasi: mv.variant_name,
        quantity: di.quantity,
        price: fp,
      });
    }

    if (oi.length === 0)
      throw new BadRequestException(
        'Tidak ada item. Kirim cart_ids atau direct_item.',
      );
    const sc = dto.shipping_cost || 0;
    const ga = tp + sc;
    const inv = this.generateInvoiceNumber();
    const newOrder = this.orderRepo.create({
      user_id: userId,
      invoice_number: inv,
      total_price: ga,
      status: 'PENDING',
      notes: dto.notes,
      items: oi as OrderItem[],
      shipping_cost: sc,
      shipping_type: dto.shipping_type || 'regular',
      courier_name: dto.courier_name || null,
      courier_service: dto.courier_service || null,
      address_id: dto.address_id || null,
      shipping_details: dto.shipping_details || null,
    } as any);
    const savedOrder = await this.orderRepo.save(newOrder);

    const cd: any = {
      first_name: user.full_name || 'Customer',
      email: user.email,
      phone: user.phone_number || '',
    };
    if (dto.address_id) {
      const addr = await this.addressRepo.findOne({
        where: { id: dto.address_id } as any,
      });
      if (addr)
        cd.shipping_address = {
          first_name: addr.recipient_name || user.full_name,
          phone: addr.phone_number || user.phone_number,
          address: addr.full_address,
        };
    }

    const tx = await this.paymentService.createTransaction(inv, ga, cd);
    if (dto.cart_ids?.length) await this.cartRepo.delete(dto.cart_ids);
    return {
      message: 'Checkout berhasil, silakan lanjutkan pembayaran',
      order: savedOrder,
      payment: { token: tx.token, redirect_url: tx.redirect_url },
    };
  }
}
