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

function extractCourierType(courier: string, rawService: string): string {
    const svc = rawService.toLowerCase();
    const c = courier.toLowerCase();
    // Common Biteship short codes by courier
    if (c === 'jne') {
        if (svc.includes('oke')) return 'oke';
        if (svc.includes('yes')) return 'yes';
        if (svc.includes('jtr')) return 'jtr';
        return 'reg';
    }
    if (c === 'jnt') {
        if (svc.includes('ez')) return 'ez';
        if (svc.includes('jnd')) return 'jnd';
        return 'ez';
    }
    if (c === 'sicepat') {
        if (svc.includes('best')) return 'best';
        if (svc.includes('reg')) return 'reg';
        if (svc.includes('sds')) return 'sds';
        return 'reg';
    }
    if (c === 'tiki') {
        if (svc.includes('eco')) return 'eco';
        if (svc.includes('reg')) return 'reg';
        if (svc.includes('ons')) return 'ons';
        return 'reg';
    }
    if (c === 'pos') {
        if (svc.includes('kilat')) return 'pos kilat khusus';
        if (svc.includes('express')) return 'express next day';
        return 'pos kilat khusus';
    }
    // Default: just use whatever Biteship provides in rates response
    if (svc.includes('regular') || svc.includes('reguler')) return 'reg';
    if (svc.includes('express')) return 'express';
    if (svc.includes('instant')) return 'instant';
    if (svc.includes('same day') || svc.includes('sameday')) return 'same_day';
    return 'reg';
}

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

    async checkoutFromCart(userId: string, dto: CheckoutCartDto) {
        const cartItems = await this.cartRepo.find({ where: { id: In(dto.cart_ids), user_id: userId }, relations: ['product', 'product.variants'] });
        if (cartItems.length === 0) throw new BadRequestException('Item keranjang tidak ditemukan.');
        let tp = 0; const oi: Partial<OrderItem>[] = [];
        for (const cart of cartItems) {
            if (!cart.product) continue;
            let mv = cart.product.variants?.find((v) => v.variant_name === cart.selected_variasi);
            if (!mv && cart.product.variants?.length > 0) mv = cart.product.variants[0];
            if (!mv) throw new BadRequestException(`Data variasi ${cart.product.name} tidak valid.`);
            if (mv.stock < cart.quantity) throw new BadRequestException(`Stok ${cart.product.name} (${mv.variant_name}) tidak mencukupi.`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            tp += fp * cart.quantity;
            oi.push({ product: { id: cart.product.id } as Product, product_name: cart.product.name, variasi: mv.variant_name, quantity: cart.quantity, price: fp });
        }
        const no = this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: tp, notes: dto.notes, items: oi as OrderItem[] } as any);
        const saved = await this.orderRepo.save(no);
        await this.cartRepo.delete(dto.cart_ids);
        return { message: 'Checkout keranjang berhasil', order: saved };
    }

    async checkoutDirect(userId: string, dto: CheckoutDirectDto) {
        const product = await this.productRepo.findOne({ where: { id: dto.product_id }, relations: ['variants'] });
        if (!product) throw new NotFoundException('Produk tidak ditemukan');
        let mv = product.variants?.find((v) => v.variant_name === dto.variasi);
        if (!mv && product.variants?.length > 0) mv = product.variants[0];
        if (!mv) throw new BadRequestException('Data variasi produk tidak valid.');
        if (mv.stock < dto.quantity) throw new BadRequestException(`Stok ${product.name} (${mv.variant_name}) hanya tersisa ${mv.stock}`);
        const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
        const no = this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: fp * dto.quantity, notes: dto.notes, items: [{ product: { id: product.id } as Product, product_name: product.name, variasi: mv.variant_name, quantity: dto.quantity, price: fp } as OrderItem] } as any);
        return { message: 'Checkout langsung berhasil', order: await this.orderRepo.save(no) };
    }

    async findMyOrders(userId: string) {
        return this.orderRepo.find({ where: { user_id: userId } as any, relations: ['items', 'items.product', 'items.product.images'], order: { created_at: 'DESC' } });
    }

    async retryPayment(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any, relations: ['user'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'PENDING') throw new BadRequestException('Hanya pesanan PENDING yang bisa dibayar ulang');
        const tx = await this.paymentService.createTransaction(`${order.invoice_number}-R${order.id.slice(0, 8)}`, Math.round(order.total_price), { first_name: order.user.full_name || 'Customer', email: order.user.email, phone: order.user.phone_number || '' });
        order.payment_token = tx.token;
        await this.orderRepo.save(order);
        return { message: 'Token pembayaran berhasil dibuat', payment: { token: tx.token, redirect_url: tx.redirect_url } };
    }

    async checkPaymentStatus(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'PENDING') return { message: `Status pesanan sudah ${order.status}`, status: order.status };
        const sk = process.env.MIDTRANS_SERVER_KEY || ''; const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
        const base = isProd ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
        const auth = Buffer.from(`${sk}:`).toString('base64');
        
        let res = await fetch(`${base}/${order.invoice_number}/status`, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } });
        let data = await res.json();
        
        // If not found, try retry suffix order ID
        if (!res.ok || res.status === 404) {
            const retryId = `${order.invoice_number}-R${order.id.slice(0, 8)}`;
            res = await fetch(`${base}/${retryId}/status`, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } });
            data = await res.json();
        }

        if (!res.ok) throw new BadRequestException(data.error_messages?.[0] || 'Failed');
        const ts = data.transaction_status, fs = data.fraud_status; let ns = order.status;
        if (ts === 'capture' && fs === 'accept') ns = 'LUNAS'; else if (ts === 'settlement') ns = 'LUNAS';
        else if (['cancel', 'deny', 'expire'].includes(ts)) ns = 'BATAL'; else if (ts === 'pending') ns = 'PENDING';
        if (order.status !== ns) { 
            order.status = ns; 
            if (ns === 'LUNAS') {
                await this.deductStock(order.id);
            }
            await this.orderRepo.save(order); 
            return { message: `→ ${ns}`, status: ns }; 
        }
        return { message: `Status masih ${order.status}`, status: order.status };
    }

    async getTrackingInfo(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        const searchResi = order.awb_number || order.tracking_number;
        if (!searchResi) return { message: 'Nomor resi belum tersedia', tracking_number: null, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [] };
        try {
            const key = process.env.BITESHIP_API_KEY || '';
            const res = await fetch(`https://api.biteship.com/v1/trackings/${searchResi}`, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (!res.ok) return { message: 'Data tracking tidak tersedia', tracking_number: searchResi, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [], raw_error: data.message };
            return { message: 'Data tracking berhasil diambil', tracking_number: searchResi, status: data.status || order.status, courier_name: order.courier_name || data.courier?.name, courier_service: order.courier_service, history: (data.history || []).map((e: any) => ({ status: e.status, note: e.note, updated_at: e.updated_at, location: e.location || null })), waybill_url: data.waybill_url || null };
        } catch (err: any) { return { message: 'Gagal mengambil data tracking', tracking_number: searchResi, status: order.status, courier_name: order.courier_name, courier_service: order.courier_service, history: [], error: err.message }; }
    }

    async cancelOrderUser(userId: string, orderId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.is_locked) throw new BadRequestException('Pesanan sudah diproses admin.');
        if (order.status !== 'PENDING') throw new BadRequestException('Hanya PENDING.');
        order.status = 'BATAL'; return { message: 'Pesanan dibatalkan', order: await this.orderRepo.save(order) };
    }

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
        return { message: `Status diubah: ${dto.status}`, order: await this.orderRepo.save(order) };
    }

    async processOrder(orderId: string, dto?: { tracking_number?: string; courier_name?: string; courier_service?: string }) {
        this.logger.log(`[PROCESS] ${orderId}`);
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user', 'items', 'items.product'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'LUNAS') throw new BadRequestException('Hanya pesanan LUNAS.');

        order.is_locked = true; order.status = 'DIKEMAS';
        if (dto?.tracking_number) order.tracking_number = dto.tracking_number;
        if (dto?.courier_name) order.courier_name = dto.courier_name;
        if (dto?.courier_service) order.courier_service = dto.courier_service;

        // Stock was already deducted when status became LUNAS (webhook or manual change)
        this.logger.log(`[PROCESS] Stock deduction skipped (handled on payment)`);

        if (order.shipping_type === 'regular' && order.courier_name) {
            this.logger.log(`[PROCESS] Generating AWB via Biteship...`);
            try {
                const awb = await this.generateAwb(order);
                if (awb) {
                    (order as any).awb_number = awb.awb_number;
                    (order as any).awb_url = awb.awb_url;
                    if (!order.tracking_number) (order as any).tracking_number = awb.awb_number;
                    this.logger.log(`[PROCESS] AWB OK: ${awb.awb_number}`);
                } else {
                    this.logger.warn(`[PROCESS] AWB FAILED - check [AWB] logs above`);
                }
            } catch (e: any) { this.logger.error(`[PROCESS] AWB exception: ${e.message}`); }
        }

        const saved = await this.orderRepo.save(order);
        this.logger.log(`[PROCESS] Done. AWB=${saved.awb_number}`);
        return { message: 'Pesanan diproses.', order: saved };
    }

    private async generateAwb(order: Order): Promise<{ awb_number: string; awb_url: string } | null> {
        const key = process.env.BITESHIP_API_KEY || '';
        if (!key) { this.logger.warn('[AWB] No API key'); return null; }

        const originName = process.env.STORE_CONTACT_NAME || 'Anandam Computer';
        const originPhone = process.env.STORE_PHONE || '6281228134747';
        const originAddr = process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta';
        const originPC = process.env.STORE_POSTAL_CODE || '55283';
        const originArea = process.env.STORE_AREA_ID || '';

        let destName = order.user?.full_name || 'Customer';
        let destPhone = order.user?.phone_number || '08123456789';
        let destAddr = '';
        let destPC = '';
        let destArea = '';

        if (order.shipping_address_snapshot) {
            const snap = order.shipping_address_snapshot;
            destName = snap.recipient_name || destName;
            destPhone = snap.phone_number || destPhone;
            destAddr = snap.full_address || '';
            destPC = snap.postal_code || '';
            destArea = snap.area_id || '';
            this.logger.log(`[AWB] Loaded from address snapshot: PC=${destPC}, Area=${destArea}`);
        } else if (order.address_id) {
            this.logger.log(`[AWB] Snapshot empty. Looking up address ID ${order.address_id}`);
            const addr = await this.addressRepo.findOne({ where: { id: order.address_id } as any });
            if (addr) {
                destName = addr.recipient_name || destName;
                destPhone = addr.phone_number || destPhone;
                destAddr = addr.full_address || '';
                destPC = addr.postal_code || '';
                destArea = addr.area_id || '';
                this.logger.log(`[AWB] Address DB found: PC=${destPC}, Area=${destArea}`);
            } else { this.logger.warn(`[AWB] Address ${order.address_id} not found!`); }
        } else { this.logger.warn(`[AWB] No address_id or address snapshot on order!`); }

        const courier = (order.courier_name || 'jne').toLowerCase();
        const svc = extractCourierType(courier, order.courier_service || '');

        const body: any = {
            origin_contact_name: originName,
            origin_contact_phone: originPhone,
            origin_address: originAddr,
            origin_postal_code: parseInt(originPC, 10) || 55283,
            destination_contact_name: destName,
            destination_contact_phone: destPhone,
            destination_address: destAddr,
            destination_postal_code: parseInt(destPC, 10) || 55283,
            courier_company: courier,
            courier_type: svc,
            delivery_type: 'later',
            items: order.items.map((item) => ({ name: item.product_name || 'Product', value: Math.max(Number(item.price) || 1000, 100), quantity: item.quantity, weight: 1000, length: 20, width: 20, height: 20 })),
        };
        if (originArea) body.origin_area_id = originArea;
        if (destArea) body.destination_area_id = destArea;

        this.logger.log(`[AWB] Sending: courier=${courier}, type=${svc}, originArea=${originArea}, destArea=${destArea}, destPC=${destPC}`);
        try {
            const res = await fetch('https://api.biteship.com/v1/orders', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            this.logger.log(`[AWB] Response ${res.status}: ${JSON.stringify(data).substring(0, 300)}`);
            if (!res.ok) { this.logger.error(`[AWB] FAIL: ${JSON.stringify(data)}`); return null; }
            const awb = data.waybill_id || data.id || '';
            const url = data.waybill_url || data.courier?.waybill_url || '';
            this.logger.log(`[AWB] SUCCESS! AWB=${awb}`);
            return { awb_number: awb, awb_url: url };
        } catch (e: any) { this.logger.error(`[AWB] Network error: ${e.message}`); return null; }
    }

    async requestPickup(orderId: string) {
        this.logger.log(`[PICKUP] ${orderId}`);
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user'] });
        if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
        if (order.status !== 'DIKEMAS') throw new BadRequestException('Hanya DIKEMAS.');
        if (order.shipping_type === 'instant') throw new BadRequestException('Gunakan Cari Driver.');
        if (!order.awb_number && !order.tracking_number) throw new BadRequestException('Belum ada AWB. Klik Proses Pesanan dulu.');

        const key = process.env.BITESHIP_API_KEY || '';
        if (!key) throw new BadRequestException('API Key Biteship belum dikonfigurasi.');

        const ref = (order.awb_number || order.tracking_number || order.invoice_number) as string;
        const cc = (order.courier_name || 'jne').toLowerCase();

        this.logger.log(`[PICKUP] Calling Biteship: order=${ref}, courier=${cc}`);
        try {
            const res = await fetch('https://api.biteship.com/v1/pickups', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: ref, courier_company: cc, pickup_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), pickup_time_zone: 'Asia/Jakarta' }) });
            const data = await res.json();
            this.logger.log(`[PICKUP] Response ${res.status}: ${JSON.stringify(data).substring(0, 200)}`);
            if (!res.ok) throw new BadRequestException(data.error || data.message || 'Gagal pickup');
            order.pickup_request_id = data.id || data.pickup_id || null;
            await this.orderRepo.save(order);
            this.logger.log(`[PICKUP] OK! pickup_id=${order.pickup_request_id}`);
            return { message: 'Pickup berhasil.', pickup: data };
        } catch (err: any) { throw new BadRequestException(`Pickup gagal: ${err.message}`); }
    }

    async searchDriver(orderId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: ['user'] });
        if (!order) throw new NotFoundException('Tidak ditemukan');
        if (order.status !== 'DIKEMAS') throw new BadRequestException('Hanya DIKEMAS.');
        if (order.shipping_type !== 'instant') throw new BadRequestException('Hanya instant.');
        let dl = '', dlg = '';
        if (order.address_id) {
            const addr = await this.addressRepo.findOne({ where: { id: order.address_id } as any });
            if (addr?.latitude && addr?.longitude) { dl = String(addr.latitude); dlg = String(addr.longitude); }
        }
        if (!dl || !dlg) throw new BadRequestException('Alamat tidak memiliki koordinat.');
        const key = process.env.BITESHIP_API_KEY || '';
        try {
            const items = order.items.map((i) => ({ name: i.product_name, value: Number(i.price), quantity: i.quantity, weight: 1000 }));
            const res = await fetch('https://api.biteship.com/v1/rates/couriers', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ origin_latitude: Number(process.env.STORE_LATITUDE || '-7.8300'), origin_longitude: Number(process.env.STORE_LONGITUDE || '110.3870'), destination_latitude: Number(dl), destination_longitude: Number(dlg), couriers: order.courier_name || 'gosend,grabexpress', items: items.map((i) => ({ ...i, weight: i.weight / 1000 })) }) });
            const data = await res.json();
            if (!res.ok) throw new BadRequestException(data.error || data.message || 'Gagal');
            if (!data.pricing?.length) return { message: 'Tidak ada driver.', driver_found: false, rates: [] };
            order.tracking_number = `INSTANT-${order.invoice_number}`;
            await this.orderRepo.save(order);
            return { message: 'Driver tersedia.', driver_found: true, rates: data.pricing };
        } catch (err: any) { throw new BadRequestException(`Gagal: ${err.message}`); }
    }

    async markDelivered(orderId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } as any });
        if (!order) throw new NotFoundException('Tidak ditemukan');
        if (order.status !== 'DIKEMAS') throw new BadRequestException('Hanya DIKEMAS.');
        order.status = 'DIKIRIM'; order.delivered_at = new Date();
        return { message: 'Dikirim.', order: await this.orderRepo.save(order) };
    }

    async confirmReceived(orderId: string, userId: string) {
        const order = await this.orderRepo.findOne({ where: { id: orderId, user_id: userId } as any });
        if (!order) throw new NotFoundException('Tidak ditemukan');
        if (order.status !== 'DIKIRIM') throw new BadRequestException('Hanya DIKIRIM.');
        order.status = 'SELESAI'; order.completed_at = new Date();
        return { message: 'Diterima!', order: await this.orderRepo.save(order) };
    }

    async autoCompleteOrders(): Promise<number> {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const orders = await this.orderRepo.find({ where: { status: 'DIKIRIM' as any, delivered_at: LessThan(twoDaysAgo) as any } });
        for (const o of orders) { o.status = 'SELESAI'; o.completed_at = new Date(); }
        if (orders.length > 0) await this.orderRepo.save(orders);
        return orders.length;
    }

    async findAllOrders(query: any) {
        const qb = this.orderRepo.createQueryBuilder('order').leftJoinAndSelect('order.user', 'user').leftJoinAndSelect('order.items', 'items').leftJoinAndSelect('user.addresses', 'addresses').leftJoinAndSelect('items.product', 'product').leftJoinAndSelect('product.images', 'images').orderBy('order.created_at', 'DESC');
        if (query.status) qb.andWhere('order.status = :status', { status: query.status });
        const [d, t] = await qb.getManyAndCount();
        return { data: d, total: t };
    }

    async findOneOrder(id: string) {
        const o = await this.orderRepo.findOne({ where: { id }, relations: ['user', 'user.addresses', 'items', 'items.product', 'items.product.images'] });
        if (!o) throw new NotFoundException(`Pesanan ${id} tidak ditemukan`);
        return o;
    }

    async checkoutPCBuilder(userId: string, dto: { items: { product_id: string; quantity: number }[]; notes?: string }) {
        if (!dto.items?.length) throw new BadRequestException('Komponen kosong');
        let tp = 0; const oi: Partial<OrderItem>[] = [];
        for (const item of dto.items) {
            const p = await this.productRepo.findOne({ where: { id: item.product_id }, relations: ['variants'] });
            if (!p) throw new NotFoundException(`Produk ${item.product_id} tidak ditemukan`);
            const mv = p.variants?.length > 0 ? p.variants[0] : null;
            if (!mv) throw new BadRequestException(`Data variasi ${p.name} tidak valid.`);
            if (mv.stock < item.quantity) throw new BadRequestException(`Stok ${p.name} tidak cukup.`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            tp += fp * item.quantity;
            oi.push({ product: { id: p.id } as Product, product_name: p.name, variasi: mv.variant_name, quantity: item.quantity, price: fp });
        }
        return { message: 'PC Builder OK', order: await this.orderRepo.save(this.orderRepo.create({ user_id: userId, invoice_number: this.generateInvoiceNumber(), total_price: tp, notes: dto.notes, items: oi as OrderItem[] } as any)) };
    }

    async createCheckout(userId: string, dto: CreateCheckoutDto) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User tidak ditemukan');
        let tp = 0; const oi: Partial<OrderItem>[] = [];

        if (dto.cart_ids?.length) {
            const cartItems = await this.cartRepo.find({ where: { id: In(dto.cart_ids), user_id: userId }, relations: ['product', 'product.variants'] });
            if (cartItems.length === 0) throw new BadRequestException('Keranjang kosong.');
            for (const cart of cartItems) {
                if (!cart.product) continue;
                let mv = cart.product.variants?.find((v) => v.variant_name === cart.selected_variasi);
                if (!mv && cart.product.variants?.length > 0) mv = cart.product.variants[0];
                if (!mv) throw new BadRequestException(`Variasi ${cart.product.name} tidak valid.`);
                if (mv.stock < cart.quantity) throw new BadRequestException(`Stok ${cart.product.name} tidak cukup.`);
                const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
                tp += fp * cart.quantity;
                oi.push({ product: { id: cart.product.id } as Product, product_name: cart.product.name, variasi: mv.variant_name, quantity: cart.quantity, price: fp });
            }
        }

        if (dto.direct_item) {
            const di = dto.direct_item;
            const p = await this.productRepo.findOne({ where: { id: di.product_id }, relations: ['variants'] });
            if (!p) throw new NotFoundException('Produk tidak ditemukan');
            let mv = p.variants?.find((v) => v.variant_name === di.variasi);
            if (!mv && p.variants?.length > 0) mv = p.variants[0];
            if (!mv) throw new BadRequestException(`Variasi ${p.name} tidak valid.`);
            if (mv.stock < di.quantity) throw new BadRequestException(`Stok ${p.name} hanya ${mv.stock}`);
            const fp = (Number(mv.price_discount || 0) > 0) ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
            tp += fp * di.quantity;
            oi.push({ product: { id: p.id } as Product, product_name: p.name, variasi: mv.variant_name, quantity: di.quantity, price: fp });
        }
        let addressSnapshot: any = null;
        const cd: any = { first_name: user.full_name || 'Customer', email: user.email, phone: user.phone_number || '' };
        if (dto.address_id) {
            const addr = await this.addressRepo.findOne({ where: { id: dto.address_id } as any });
            if (addr) {
                addressSnapshot = {
                    recipient_name: addr.recipient_name || user.full_name,
                    phone_number: addr.phone_number || user.phone_number,
                    full_address: addr.full_address,
                    postal_code: addr.postal_code,
                    latitude: addr.latitude,
                    longitude: addr.longitude,
                    area_id: addr.area_id
                };
                cd.shipping_address = { first_name: addr.recipient_name || user.full_name, phone: addr.phone_number || user.phone_number, address: addr.full_address };
            }
        }

        if (oi.length === 0) throw new BadRequestException('Tidak ada item.');
        const sc = dto.shipping_cost || 0; const ga = tp + sc; const inv = this.generateInvoiceNumber();
        const roundedAmount = Math.round(ga);
        
        const tx = await this.paymentService.createTransaction(inv, roundedAmount, cd);
        
        const no = this.orderRepo.create({ 
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
            shipping_address_snapshot: addressSnapshot,
            payment_token: tx.token
        } as any);
        const saved = await this.orderRepo.save(no);

        if (dto.cart_ids?.length) await this.cartRepo.delete(dto.cart_ids);
        return { message: 'Checkout berhasil', order: saved, payment: { token: tx.token, redirect_url: tx.redirect_url } };
    }
}