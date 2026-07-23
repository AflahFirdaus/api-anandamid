import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DataSource } from 'typeorm';
import { Cart } from './entities/cart.entity';

@Injectable()
export class CartService {
    constructor(
        @InjectRepository(Cart)
        private cartRepo: Repository<Cart>,
        private readonly dataSource: DataSource,
    ) {}

    async addToCart(userId: string, productId: string, quantity: number, variasi?: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Pessimistic lock untuk mencegah race condition
            const cartItem = await queryRunner.manager.findOne(Cart, {
                where: {
                    user_id: userId,
                    product_id: productId,
                    selected_variasi: variasi ? variasi : IsNull()
                },
                lock: { mode: 'pessimistic_write' },
            } as any);

            let result;
            if (cartItem) {
                cartItem.quantity += quantity;
                result = await queryRunner.manager.save(Cart, cartItem);
            } else {
                const newItem = this.cartRepo.create({
                    user_id: userId,
                    product_id: productId,
                    quantity,
                    selected_variasi: variasi || null
                });
                result = await queryRunner.manager.save(Cart, newItem);
            }

            await queryRunner.commitTransaction();
            return result;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async getMyCart(userId: string) {
        const carts = await this.cartRepo.find({
            where: { user_id: userId },
            relations: ['product', 'product.images', 'product.variants'],
            order: { created_at: 'DESC' },
        });

        return carts.map((item) => {
            const mainImage = item.product.images?.find((img) => img.sort_order === 0)
                            || item.product.images?.[0];

            let matchedVariant = item.product.variants?.find(
                (v) => v.variant_name === item.selected_variasi
            );

            if (!matchedVariant && item.product.variants && item.product.variants.length > 0) {
                matchedVariant = item.product.variants[0];
            }

            return {
                id: item.id,
                quantity: item.quantity,
                selected_variasi: item.selected_variasi || matchedVariant?.variant_name,
                product: {
                    id: item.product.id,
                    name: item.product.name,
                    price_normal: Number(matchedVariant?.price_normal || 0),
                    price_discount: Number(matchedVariant?.price_discount || 0),
                    stock: Number(matchedVariant?.stock || 0),
                    thumbnail: mainImage?.thumbnail_url || null,
                    weight: Number(item.product.weight) || 0,
                    length: Number(item.product.length) || 0,
                    width: Number(item.product.width) || 0,
                    height: Number(item.product.height) || 0,
                },
            };
        });
    }

    async updateQuantity(userId: string, cartId: string, quantity: number) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const cartItem = await queryRunner.manager.findOne(Cart, {
                where: { id: cartId, user_id: userId },
                lock: { mode: 'pessimistic_write' },
            } as any);
            
            if (!cartItem) throw new NotFoundException('Item keranjang tidak ditemukan');

            if (quantity <= 0) {
                await queryRunner.manager.remove(Cart, cartItem);
                await queryRunner.commitTransaction();
                return { message: 'Produk dihapus dari keranjang' };
            }

            cartItem.quantity = quantity;
            const result = await queryRunner.manager.save(Cart, cartItem);
            await queryRunner.commitTransaction();
            return result;
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async removeFromCart(userId: string, cartId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const cartItem = await queryRunner.manager.findOne(Cart, {
                where: { id: cartId, user_id: userId },
                lock: { mode: 'pessimistic_write' },
            } as any);
            
            if (!cartItem) throw new NotFoundException('Item keranjang tidak ditemukan');

            await queryRunner.manager.remove(Cart, cartItem);
            await queryRunner.commitTransaction();
            return { message: 'Produk dihapus dari keranjang' };
        } catch (err) {
            await queryRunner.rollbackTransaction();
            throw err;
        } finally {
            await queryRunner.release();
        }
    }

    async clearCart(userId: string) {
        // Clear cart tidak perlu lock karena menghapus semua milik user
        await this.cartRepo.delete({ user_id: userId });
        return { message: 'Keranjang dikosongkan' };
    }
}