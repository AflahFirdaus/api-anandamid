import {
    Entity, Column, PrimaryGeneratedColumn, CreateDateColumn,
    UpdateDateColumn, ManyToOne, OneToMany, JoinColumn
} from "typeorm";
import { Expose } from "class-transformer";
import { Product } from "./product.entity";
import { ProductImage } from "src/product-image/entities/product-image.entity";

@Entity('product_variants')
export class ProductVariant {

    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Product, (product) => product.variants, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'product_id' })
    product: Product;

    // 🔥 TAMBAH INI — relasi balik ke images
    @OneToMany(() => ProductImage, (img) => img.variant)
    images: ProductImage[];

    @Column({ type: 'varchar', length: 100 })
    variant_name: string;

    @Column({ type: 'text', nullable: true })
    sku_seller: string | null;

    @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
    price_normal: number | null;

    @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
    price_discount: number | null;

    @Column({ type: 'integer', default: 0 })
    stock: number;

    @Column({ type: 'int', default: 0 })
    weight: number;

    @Column({ type: 'int', default: 0 })
    length: number;

    @Column({ type: 'int', default: 0 })
    width: number;

    @Column({ type: 'int', default: 0 })
    height: number;

    @Expose()
    get final_price(): number {
        const normal = Number(this.price_normal ?? 0);
        const discount = Number(this.price_discount ?? 0);
        const final = normal - discount;
        return final > 0 ? final : 0;
    }

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}