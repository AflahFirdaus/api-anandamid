import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm'; 
import { Cart } from './entities/cart.entity';

@Injectable()
export class CartService {
    constructor(
        @InjectRepository(Cart)
        private cartRepo: Repository<Cart>,
    ) {}

    async addToCart(userId: string, productId: string, quantity: number, variasi?: string) {
        const cartItem = await this.cartRepo.findOne({
            where: { 
                user_id: userId, 
                product_id: productId, 
                selected_variasi: variasi ? variasi : IsNull() 
            }
        });

        if (cartItem) {
            cartItem.quantity += quantity;
            return this.cartRepo.save(cartItem);
        } else {
            const newItem = this.cartRepo.create({
                user_id: userId,
                product_id: productId,
                quantity,
                selected_variasi: variasi || null
            });
            return this.cartRepo.save(newItem);
        }
    }

    async getMyCart(userId: string) {
        const carts = await this.cartRepo.find({
            where: { user_id: userId },
            relations: ['product', 'product.images', 'product.variants'], // 🔥 Load relasi variants
            select: {
                id: true,
                quantity: true,
                selected_variasi: true,
                product: {
                    id: true,
                    name: true,
                    // 🔥 Kolom harga dan stok produk dihapus dari select
                    images: {
                        id: true,
                        thumbnail_url: true,
                        sort_order: true,
                    },
                    variants: { // 🔥 Tambahkan select untuk variant
                        id: true,
                        variant_name: true,
                        price_normal: true,
                        price_discount: true,
                        stock: true,
                    }
                },
            },
            order: { created_at: 'DESC' },
        });

        return carts.map((item) => {
            const mainImage = item.product.images?.find((img) => img.sort_order === 0) 
                            || item.product.images?.[0];

            // 🔥 LOGIC BARU: Cocokkan variasi keranjang dengan data di database
            let matchedVariant = item.product.variants?.find(
                (v) => v.variant_name === item.selected_variasi
            );

            // Kalau gak ketemu cocokannya (atau produk simple tanpa variasi), pakai variasi Default/pertama
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
                    // 🔥 Ambil harga dan stok dari matchedVariant
                    price_normal: Number(matchedVariant?.price_normal || 0),
                    price_discount: Number(matchedVariant?.price_discount || 0),
                    stock: Number(matchedVariant?.stock || 0),
                    thumbnail: mainImage?.thumbnail_url || null,
                    // 🔥 Dimensi dan berat untuk perhitungan ongkir
                    weight: item.product.weight || 0,
                    length: item.product.length || 0,
                    width: item.product.width || 0,
                    height: item.product.height || 0,
                },
            };
        });
    }

    async updateQuantity(userId: string, cartId: string, quantity: number) {
        const cartItem = await this.cartRepo.findOne({ where: { id: cartId, user_id: userId } });
        if (!cartItem) throw new NotFoundException('Item keranjang tidak ditemukan');
        
        if (quantity <= 0) {
            return this.removeFromCart(userId, cartId);
        }

        cartItem.quantity = quantity;
        return this.cartRepo.save(cartItem);
    }

    async removeFromCart(userId: string, cartId: string) {
        const cartItem = await this.cartRepo.findOne({ where: { id: cartId, user_id: userId } });
        if (!cartItem) throw new NotFoundException('Item keranjang tidak ditemukan');
        
        await this.cartRepo.remove(cartItem);
        return { message: 'Produk dihapus dari keranjang' };
    }

    async clearCart(userId: string) {
        await this.cartRepo.delete({ user_id: userId });
        return { message: 'Keranjang dikosongkan' };
    }
}