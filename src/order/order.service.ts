import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../product/entities/product.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { User } from '../user/entities/user.entity';
import { UserAddress } from '../user/entities/user-address.entity';
import { CheckoutCartDto, CheckoutDirectDto, CreateCheckoutDto } from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class OrderService {
    private readonly logger = new Logger(OrderService.name);

    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
        @InjectRepository(Cart) private cartRepo: Repository<Cart>,
        @InjectRepository(Product) private productRepo: Repository<Product>,
        @InjectRepository(ProductVariant) private variantRepo: Repository<ProductVariant>,
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(UserAddress) private addressRepo: Repository<UserAddress>,
        private readonly paymentService: PaymentService,
    ) {}

    private generateInvoiceNumber(): string {
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        return `INV-${dateStr}-${randomNum}`;
    }

    // ====================== STOCK HELPERS ======================
    async deductStock(orderId: string): Promise<void> {
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['items', 'items.product', 'items.product.variants'] });
        if (!order) return;
        for (const item of order.items) {
            if (!item.product) continue;
            let mv = item.product.variants?.find((v) => v.variant_name === item.variasi);
            if (!mv && item.product.variants?.length > 0) mv = item.product.variants[0];
            if (mv) {
                if (mv.stock < item.quantity) throw new BadRequestException(`Stok ${item.product.name} (${mv.variant_name}) tidak mencukupi.`);
                mv.stock -= item.quantity;
                await this.variantRepo.save(mv);
            }
        }
    }

    async restoreStock(orderId: string): Promise<void> {
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['items', 'items.product', 'items.product.variants'] });
        if (!order) return;
        for (const item of order.items) {
            if (!item.product) continue;
            let mv = item.product.variants?.find((v) => v.variant_name === item.variasi);
            if (!mv && item.product.variants?.length > 0) mv = item.product.variants[0];
            if (mv) { mv.stock += item.quantity; await this.variantRepo.save(mv); }
        }
    }

    // ====================== CHECKOUT ======================
    async checkoutFromCart(userId: string, dto: CheckoutCartDto) {
        const cartItems = await this.cartRepo.find({ where: { id: In(dto.cart_ids), user_id: userId }, relations: ['product', 'product.variants'] });
        if (cartItems.length === 0) throw new BadRequestException('Item keranjang tidak ditemukan.');
        let totalPrice = 0;
        const oi: Partial<OrderItem>[] = [];
        for (const cart of cartItems) {
            if (!cart.product) continue;
            let mv = cart.product.variants?.find((v) => v.variant_name === cart.selected_variasi);
            if (!mv && cart.product.variants?.length > 0) mv = cart.product.variants[0];
            if (!mv) throw new BadRequestException(`Data variasi ${cart.product.name} tidak valid.`);
            if (mv.stock < cart.quantity) throw new BadRequestException(`Stok ${cart.product.name} (${mv.variant_name}) tidak mencukupi.`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            totalPrice += fp * cart.quantity;
            oi.push({ product: { id: cart.product.id } as Product, product_name: cart.product.name, variasi: mv.variant_name, quantity: cart.quantity, price: fp });
        }
        const newOrder = this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: totalPrice, notes: dto.notes, items: oi as OrderItem[] } as any);
        const savedOrder = await this.orderRepo.save(newOrder);
        await this.cartRepo.delete(dto.cart_ids);
        return { message: 'Checkout keranjang berhasil', order: savedOrder };
    }

    async checkoutDirect(userId: string, dto: CheckoutDirectDto) {
        const product = await this.productRepo.findOne({ where: { id: dto.product_id }, relations: ['variants'] });
        if (!product) throw new NotFoundException('Produk tidak ditemukan');
        let mv = product.variants?.find((v) => v.variant_name === dto.variasi);
        if (!mv && product.variants?.length > 0) mv = product.variants[0];
        if (!mv) throw new BadRequestException('Data variasi produk tidak valid.');
        if (mv.stock < dto.quantity) throw new BadRequestException(`Stok ${product.name} (${mv.variant_name}) hanya tersisa ${mv.stock}`);
        const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
        const newOrder = this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: fp * dto.quantity, notes: dto.notes, items: [{ product: { id: product.id } as Product, product_name: product.name, variasi: mv.variant_name, quantity: dto.quantity, price: fp } as OrderItem] } as any);
        return { message: 'Checkout langsung berhasil', order: await this.orderRepo.save(newOrder) };
    }

    async findMyOrders(userId: string) {
        return this.orderRepo.find({ where: { user_id: userId } as any, relations: ['items', 'items.product', 'items.product.images'], order: { created_at: 'DESC' } });
    }

    // ====================== PAYMENT ======================
    async retryPayment(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any, relations: ['user'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'PENDING') throw new BadRequestException('Hanya pesanan PENDING yang bisa dibayar ulang');
        const tx = await this.paymentService.createTransaction(`${order.invoice_number}-R${order.id.slice(0, 8)}`, order.total_price, { first_name: order.user.full_name || 'Customer', email: order.user.email, phone: order.user.phone_number || '' });
        return { message: 'Token pembayaran berhasil dibuat', payment: { token: tx.token, redirect_url: tx.redirect_url } };
    }

    async checkPaymentStatus(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'PENDING') return { message: `Status pesanan sudah ${order.status}`, status: order.status };
        const sk = process.env.MIDTRANS_SERVER_KEY || '';
        const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
        const base = isProd ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
        const auth = Buffer.from(`${sk}:`).toString('base64');
        const res = await fetch(`${base}/${order.invoice_number}/status`, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } });
        const data = await res.json();
        if (!res.ok) throw new BadRequestException(data.error_messages?.[0] || 'Failed check');
        const ts = data.transaction_status, fs = data.fraud_status;
        let ns = order.status;
        if (ts === 'capture' && fs === 'accept') ns = 'LUNAS';
        else if (ts === 'settlement') ns = 'LUNAS';
        else if (['cancel', 'deny', 'expire'].includes(ts)) ns = 'BATAL';
        else if (ts === 'pending') ns = 'PENDING';
        if (order.status !== ns) { order.status = ns; await this.orderRepo.save(order); return { message: `Status: → ${ns}`, status: ns }; }
        return { message: `Status masih ${order.status}`, status: order.status };
    }

    // ====================== TRACKING ======================
    async getTrackingInfo(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (!order.tracking_number) return { message: 'Nomor resi belum tersedia', tracking_number: null, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [] };
        try {
            const key = process.env.BITESHIP_API_KEY || '';
            const res = await fetch(`https://api.biteship.com/v1/trackings/${order.tracking_number}`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (!res.ok) return { message: 'Data tracking tidak tersedia', tracking_number: order.tracking_number, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [], raw_error: data.message };
            return { message: 'Data tracking berhasil diambil', tracking_number: order.tracking_number, status: data.status || order.status, courier_name: order.courier_name || data.courier?.name, courier_service: order.courier_service, history: (data.history || []).map((e: any) => ({ status: e.status, note: e.note, updated_at: e.updated_at, location: e.location || null })), waybill_url: data.waybill_url || null };
        } catch (err: any) { return { message: 'Gagal mengambil data tracking', tracking_number: order.tracking_number, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [], error: err.message }; }
    }

    // ====================== CANCEL ======================
    async cancelOrderUser(userId: string, orderId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.is_locked) throw new BadRequestException('Pesanan sudah diproses admin, tidak dapat dibatalkan.');
        if (order.status !== 'PENDING') throw new BadRequestException('Hanya pesanan PENDING yang dapat dibatalkan.');
        order.status = 'BATAL';
        return { message: 'Pesanan berhasil dibatalkan', order: await this.orderRepo.save(order) };
    }

    // ====================== UPDATE STATUS (ADMIN) ======================
    async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto) {
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['items', 'items.product', 'items.product.variants'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status === 'PENDING' && dto.status === 'LUNAS') await this.deductStock(orderId);
        if (order.status === 'LUNAS' && dto.status === 'BATAL') await this.restoreStock(orderId);
        if (dto.status === 'DIKIRIM') order.delivered_at = new Date();
        if (dto.status === 'SELESAI') order.completed_at = new Date();
        order.status = dto.status as string;
        if (dto.tracking_number !== undefined) order.tracking_number = dto.tracking_number;
        if (dto.courier_name !== undefined) order.courier_name = dto.courier_name;
        if (dto.courier_service !== undefined) order.courier_service = dto.courier_service;
        if (dto.awb_number !== undefined) order.awb_number = dto.awb_number;
        if (dto.awb_url !== undefined) order.awb_url = dto.awb_url;
        return { message: `Status diubah menjadi ${dto.status}`, order: await this.orderRepo.save(order) };
    }

    // ====================== PROSES PESANAN (ADMIN) ======================
    async processOrder(orderId: string, dto?: { tracking_number?: string; courier_name?: string; courier_service?: string }) {
        this.logger.log(`[PROCESS] Memproses order ${orderId}`);
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user', 'items', 'items.product'] });
        if (!order) { this.logger.error(`[PROCESS] Order ${orderId} tidak ditemukan`); throw new NotFoundException('Pesanan tidak ditemukan'); }
        if (order.status !== 'LUNAS') { this.logger.warn(`[PROCESS] Order ${orderId} status=${order.status}, bukan LUNAS`); throw new BadRequestException('Hanya pesanan LUNAS yang bisa diproses.'); }

        this.logger.log(`[PROCESS] Order ${orderId} - shipping_type=${order.shipping_type}, courier=${order.courier_name}, address_id=${order.address_id}`);

        order.is_locked = true;
        order.status = 'DIKEMAS';
        if (dto?.tracking_number) order.tracking_number = dto.tracking_number;
        if (dto?.courier_name) order.courier_name = dto.courier_name;
        if (dto?.courier_service) order.courier_service = dto.courier_service;

        // Deduct stock first
        await this.deductStock(orderId);
        this.logger.log(`[PROCESS] Order ${orderId} - stok terpotong`);

        // Generate AWB via Biteship for regular shipping
        if (order.shipping_type === 'regular' && order.courier_name) {
            this.logger.log(`[PROCESS] Order ${orderId} - Mencoba generate AWB via Biteship...`);
            try {
                const awb = await this.generateAwb(order);
                if (awb) {
                    (order as any).awb_number = awb.awb_number;
                    (order as any).awb_url = awb.awb_url;
                    if (!order.tracking_number) (order as any).tracking_number = awb.awb_number;
                    this.logger.log(`[PROCESS] Order ${orderId} - AWB berhasil: ${awb.awb_number}, label URL: ${awb.awb_url}`);
                } else {
                    this.logger.warn(`[PROCESS] Order ${orderId} - Gagal generate AWB (return null), shipping_type=${order.shipping_type}, courier=${order.courier_name}, address_id=${order.address_id}`);
                }
            } catch (e: any) {
                this.logger.error(`[PROCESS] Order ${orderId} - Exception generate AWB: ${e.message}`, e.stack);
            }
        } else if (order.shipping_type !== 'regular') {
            this.logger.log(`[PROCESS] Order ${orderId} - Instant shipping, AWB tidak digenerate`);
        } else {
            this.logger.warn(`[PROCESS] Order ${orderId} - Tidak bisa generate AWB: shipping_type=regular tapi courier_name kosong`);
        }

        const saved = await this.orderRepo.save(order);
        this.logger.log(`[PROCESS] Order ${orderId} selesai diproses. AWB=${saved.awb_number}, Label=${saved.awb_url}`);
        return { message: 'Pesanan diproses dan dikunci.', order: saved };
    }

    // ====================== GENERATE AWB VIA BITESHIP ======================
    private async generateAwb(order: Order): Promise<{ awb_number: string; awb_url: string } | null> {
        const key = process.env.BITESHIP_API_KEY || '';
        if (!key) { this.logger.warn('[AWB] BITESHIP_API_KEY tidak dikonfigurasi'); return null; }

        // Resolve origin address from store env vars
        const originContactName = process.env.STORE_CONTACT_NAME || 'Anandam Computer';
        const originPhone = process.env.STORE_PHONE || '6281228134747';
        const originAddress = process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta';
        const originPostalCode = process.env.STORE_POSTAL_CODE || '55283';
        const originAreaId = process.env.STORE_AREA_ID || '55283';

        // Resolve destination address from order.address_id
        let destContactName = order.user?.full_name || 'Customer';
        let destPhone = order.user?.phone_number || '08123456789';
        let destAddress = '';
        let destPostalCode = '';
        let destAreaId = '';

        if (order.address_id) {
            this.logger.log(`[AWB] Mencari alamat tujuan dari address_id=${order.address_id}`);
            const addr = await this.addressRepo.findOne({ where: { id: order.address_id } as any });
            if (addr) {
                destContactName = addr.recipient_name || destContactName;
                destPhone = addr.phone_number || destPhone;
                destAddress = addr.full_address || '';
                destPostalCode = addr.postal_code || '';
                destAreaId = addr.area_id || '';
                this.logger.log(`[AWB] Alamat ditemukan: nama=${destContactName}, kode_pos=${destPostalCode}, area_id=${destAreaId}, lat=${addr.latitude}, lng=${addr.longitude}`);
            } else {
                this.logger.warn(`[AWB] Address dengan id=${order.address_id} tidak ditemukan!`);
            }
        } else {
            this.logger.warn(`[AWB] Order tidak memiliki address_id, alamat tujuan kosong!`);
        }

        const courierCompany = (order.courier_name || 'jne').toLowerCase();
        const courierType = (order.courier_service || 'reg').toLowerCase();

        const body: any = {
            origin_contact_name: originContactName,
            origin_contact_phone: originPhone,
            origin_address: originAddress,
            origin_postal_code: parseInt(originPostalCode, 10) || 55283,
            destination_contact_name: destContactName,
            destination_contact_phone: destPhone,
            destination_address: destAddress,
            destination_postal_code: parseInt(destPostalCode, 10) || 55283,
            courier_company: courierCompany,
            courier_type: courierType,
            delivery_type: 'later' as const,
            items: order.items.map((item) => ({
                name: item.product_name || 'Product',
                value: Math.max(Number(item.price) || 1000, 100),
                quantity: item.quantity,
                weight: 1000,
                length: 20,
                width: 20,
                height: 20,
            })),
        };

        if (originAreaId) body.origin_area_id = originAreaId;
        if (destAreaId) body.destination_area_id = destAreaId;

        this.logger.log(`[AWB] Mengirim request ke Biteship: courier=${courierCompany}, type=${courierType}, origin_area=${originAreaId}, dest_area=${destAreaId}`);
        this.logger.log(`[AWB] Request body: ${JSON.stringify(body).substring(0, 500)}`);

        try {
            const res = await fetch('https://api.biteship.com/v1/orders', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();
            this.logger.log(`[AWB] Biteship response status=${res.status}: ${JSON.stringify(data).substring(0, 500)}`);

            if (!res.ok) {
                this.logger.error(`[AWB] Biteship ERROR ${res.status}: ${JSON.stringify(data)}`);
                return null;
            }

            const awbNumber = data.waybill_id || data.id || '';
            const awbUrl = data.waybill_url || data.courier?.waybill_url || '';
            this.logger.log(`[AWB] SUCCESS! AWB=${awbNumber}, Label URL=${awbUrl}`);
            return { awb_number: awbNumber, awb_url: awbUrl };
        } catch (e: any) {
            this.logger.error(`[AWB] Network error: ${e.message}`, e.stack);
            return null;
        }
    }

    // ====================== REQUEST PICKUP (ADMIN - REGULAR) ======================
    async requestPickup(orderId: string) {
        this.logger.log(`[PICKUP] Request pickup untuk order ${orderId}`);
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user'] });
        if (!order) { this.logger.error(`[PICKUP] Order ${orderId} tidak ditemukan`); throw new NotFoundException('Pesanan tidak ditemukan'); }
        if (order.status !== 'DIKEMAS') { this.logger.warn(`[PICKUP] Order ${orderId} status=${order.status}, bukan DIKEMAS`); throw new BadRequestException('Hanya pesanan DIKEMAS yang bisa minta pickup.'); }
        if (order.shipping_type === 'instant') throw new BadRequestException('Gunakan "Cari Driver" untuk instant.');

        // Validate AWB exists before requesting pickup
        if (!order.awb_number && !order.tracking_number) {
            this.logger.warn(`[PICKUP] Order ${orderId} belum memiliki AWB/tracking_number. Jalankan "Proses" terlebih dahulu.`);
            throw new BadRequestException('Pesanan belum memiliki nomor resi/AWB. Silakan klik "Proses Pesanan" terlebih dahulu untuk generate label pengiriman.');
        }

        const key = process.env.BITESHIP_API_KEY || '';
        if (!key) { this.logger.error('[PICKUP] BITESHIP_API_KEY tidak dikonfigurasi'); throw new BadRequestException('API Key Biteship belum dikonfigurasi.'); }

        const orderRef = (order.awb_number || order.tracking_number || order.invoice_number) as string;
        const courierCompany = (order.courier_name || 'jne').toLowerCase();

        this.logger.log(`[PICKUP] Memanggil Biteship pickup API untuk order_ref=${orderRef}, courier=${courierCompany}`);

        try {
            const res = await fetch('https://api.biteship.com/v1/pickups', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    order_id: orderRef,
                    courier_company: courierCompany,
                    pickup_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
                    pickup_time_zone: 'Asia/Jakarta',
                }),
            });

            const data = await res.json();
            this.logger.log(`[PICKUP] Biteship pickup response status=${res.status}: ${JSON.stringify(data).substring(0, 300)}`);

            if (!res.ok) {
                const msg = data.error || data.message || 'Gagal request pickup';
                this.logger.error(`[PICKUP] Biteship pickup ERROR: ${msg}`);
                throw new BadRequestException(`Gagal request pickup: ${msg}`);
            }

            order.pickup_request_id = data.id || data.pickup_id || null;
            await this.orderRepo.save(order);

            this.logger.log(`[PICKUP] Pickup berhasil! pickup_id=${order.pickup_request_id}`);
            return { message: 'Request pickup berhasil dikirim ke kurir.', pickup: data };
        } catch (err: any) {
            this.logger.error(`[PICKUP] Exception: ${err.message}`, err.stack);
            throw new BadRequestException(`Gagal request pickup: ${err.message}`);
        }
    }

    // ====================== CARI DRIVER (ADMIN - INSTANT) ======================
    async searchDriver(orderId: string) {
        this.logger.log(`[DRIVER] Cari driver untuk order ${orderId}`);
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'DIKEMAS') throw new BadRequestException('Hanya pesanan DIKEMAS yang bisa cari driver.');
        if (order.shipping_type !== 'instant') throw new BadRequestException('Fitur ini hanya untuk instant.');

        let dl = '', dlg = '';
        if (order.address_id) {
            const addr = await this.addressRepo.findOne({ where: { id: order.address_id } as any });
            if (addr?.latitude && addr?.longitude) { dl = String(addr.latitude); dlg = String(addr.longitude); }
            this.logger.log(`[DRIVER] Address lat/lng = ${dl}, ${dlg}`);
        }
        if (!dl || !dlg) throw new BadRequestException('Alamat tujuan tidak memiliki koordinat (latitude/longitude). Pastikan alamat sudah di-pinpoint di peta.');

        const key = process.env.BITESHIP_API_KEY || '';
        try {
            const items = order.items.map((i) => ({ name: i.product_name, value: Number(i.price), quantity: i.quantity, weight: 1000 }));
            const res = await fetch('https://api.biteship.com/v1/rates/couriers', {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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
            this.logger.log(`[DRIVER] Response status=${res.status}: ${JSON.stringify(data).substring(0, 300)}`);
            if (!res.ok) throw new BadRequestException(data.error || data.message || 'Gagal mencari driver');
            if (!data.pricing?.length) return { message: 'Tidak ada driver tersedia untuk rute ini.', driver_found: false, rates: [] };
            order.tracking_number = `INSTANT-${order.invoice_number}`;
            await this.orderRepo.save(order);
            return { message: 'Driver tersedia.', driver_found: true, rates: data.pricing };
        } catch (err: any) { throw new BadRequestException(`Gagal cari driver: ${err.message}`); }
    }

    // ====================== MARK DELIVERED & CONFIRM ======================
    async markDelivered(orderId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'DIKEMAS') throw new BadRequestException('Hanya pesanan DIKEMAS.');
        order.status = 'DIKIRIM'; order.delivered_at = new Date();
        return { message: 'Pesanan dikirim.', order: await this.orderRepo.save(order) };
    }

    async confirmReceived(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'DIKIRIM') throw new BadRequestException('Hanya pesanan DIKIRIM.');
        order.status = 'SELESAI'; order.completed_at = new Date();
        return { message: 'Pesanan diterima. Terima kasih!', order: await this.orderRepo.save(order) };
    }

    // ====================== AUTO COMPLETE ======================
    async autoCompleteOrders(): Promise<number> {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const orders = await this.orderRepo.find({ where: { status: 'DIKIRIM' as any, delivered_at: LessThan(twoDaysAgo) as any } });
        for (const o of orders) { o.status = 'SELESAI'; o.completed_at = new Date(); }
        if (orders.length > 0) await this.orderRepo.save(orders);
        return orders.length;
    }

    // ====================== ADMIN QUERIES ======================
    async findAllOrders(query: any) {
        const qb = this.orderRepo.createQueryBuilder('order').leftJoinAndSelect('order.user', 'user').leftJoinAndSelect('order.items', 'items').leftJoinAndSelect('user.addresses', 'addresses').leftJoinAndSelect('items.product', 'product').leftJoinAndSelect('product.images', 'images').orderBy('order.created_at', 'DESC');
        if (query.status) qb.andWhere('order.status = :status', { status: query.status });
        const [data, total] = await qb.getManyAndCount();
        return { data, total };
    }

    async findOneOrder(id: string) {
        const order = await this.orderRepo.findOne({ where: { id }, relations: ['user', 'user.addresses', 'items', 'items.product', 'items.product.images'] });
        if (!order) throw new NotFoundException(`Pesanan ${id} tidak ditemukan`);
        return order;
    }

    // ====================== CHECKOUT PC BUILDER ======================
    async checkoutPCBuilder(userId: string, dto: { items: { product_id: string; quantity: number }[]; notes?: string }) {
        if (!dto.items?.length) throw new BadRequestException('Komponen tidak boleh kosong');
        let tp = 0; const oi: Partial<OrderItem>[] = [];
        for (const item of dto.items) {
            const product = await this.productRepo.findOne({ where: { id: item.product_id }, relations: ['variants'] });
            if (!product) throw new NotFoundException(`Produk ${item.product_id} tidak ditemukan`);
            const mv = product.variants?.length > 0 ? product.variants[0] : null;
            if (!mv) throw new BadRequestException(`Data variasi ${product.name} tidak valid.`);
            if (mv.stock < item.quantity) throw new BadRequestException(`Stok ${product.name} tidak mencukupi.`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            tp += fp * item.quantity;
            oi.push({ product: { id: product.id } as Product, product_name: product.name, variasi: mv.variant_name, quantity: item.quantity, price: fp });
        }
        const no = this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: tp, notes: dto.notes, items: oi as OrderItem[] } as any);
        return { message: 'Checkout Rakitan PC berhasil', order: await this.orderRepo.save(no) };
    }

    // ====================== CHECKOUT + MIDTRANS ======================
    async createCheckout(userId: string, dto: CreateCheckoutDto) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User tidak ditemukan');
        let tp = 0; const oi: Partial<OrderItem>[] = [];

        if (dto.cart_ids?.length) {
            const cartItems = await this.cartRepo.find({ where: { id: In(dto.cart_ids), user_id: userId }, relations: ['product', 'product.variants'] });
            if (cartItems.length === 0) throw new BadRequestException('Item keranjang tidak ditemukan.');
            for (const cart of cartItems) {
                if (!cart.product) continue;
                let mv = cart.product.variants?.find((v) => v.variant_name === cart.selected_variasi);
                if (!mv && cart.product.variants?.length > 0) mv = cart.product.variants[0];
                if (!mv) throw new BadRequestException(`Data variasi ${cart.product.name} tidak valid.`);
                if (mv.stock < cart.quantity) throw new BadRequestException(`Stok ${cart.product.name} tidak mencukupi.`);
                const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
                tp += fp * cart.quantity;
                oi.push({ product: { id: cart.product.id } as Product, product_name: cart.product.name, variasi: mv.variant_name, quantity: cart.quantity, price: fp });
            }
        }

        if (dto.direct_item) {
            const di = dto.direct_item;
            const product = await this.productRepo.findOne({ where: { id: di.product_id }, relations: ['variants'] });
            if (!product) throw new NotFoundException('Produk tidak ditemukan');
            let mv = product.variants?.find((v) => v.variant_name === di.variasi);
            if (!mv && product.variants?.length > 0) mv = product.variants[0];
            if (!mv) throw new BadRequestException(`Data variasi ${product.name} tidak valid.`);
            if (mv.stock < di.quantity) throw new BadRequestException(`Stok ${product.name} hanya tersisa ${mv.stock}`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            tp += fp * di.quantity;
            oi.push({ product: { id: product.id } as Product, product_name: product.name, variasi: mv.variant_name, quantity: di.quantity, price: fp });
        }

        if (oi.length === 0) throw new BadRequestException('Tidak ada item.');
        const sc = dto.shipping_cost || 0; const ga = tp + sc; const inv = this.generateInvoiceNumber();
        const newOrder = this.orderRepo.create({ user_id: userId, invoice_number: inv, total_price: ga, status: 'PENDING', notes: dto.notes, items: oi as OrderItem[], shipping_cost: sc, shipping_type: dto.shipping_type || 'regular', courier_name: dto.courier_name || null, courier_service: dto.courier_service || null, address_id: dto.address_id || null, shipping_details: dto.shipping_details || null } as any);
        const savedOrder = await this.orderRepo.save(newOrder);

        const cd: any = { first_name: user.full_name || 'Customer', email: user.email, phone: user.phone_number || '' };
        if (dto.address_id) {
            const addr = await this.addressRepo.findOne({ where: { id: dto.address_id } as any });
            if (addr) cd.shipping_address = { first_name: addr.recipient_name || user.full_name, phone: addr.phone_number || user.phone_number, address: addr.full_address };
        }

        const tx = await this.paymentService.createTransaction(inv, ga, cd);
        if (dto.cart_ids?.length) await this.cartRepo.delete(dto.cart_ids);
        return { message: 'Checkout berhasil, silakan lanjutkan pembayaran', order: savedOrder, payment: { token: tx.token, redirect_url: tx.redirect_url } };
    }
}