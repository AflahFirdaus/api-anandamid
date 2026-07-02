import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    OneToMany,
    JoinColumn
} from "typeorm";

import { Category } from "../../category/entities/category.entity";
import { ProductImage } from "../../product-image/entities/product-image.entity";
import { Brand } from "../../brand/entities/brand.entity";
import { ProductVariant } from "./product-variant.entity"; // Import entity baru

@Entity('products')
export class Product {

    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({
        type: 'varchar',
        length: 100,
        unique: true
    })
    product_id: string;

    @ManyToOne(() => Category, (category) => category.products, {
        onDelete: 'RESTRICT',
        nullable: true,
    })
    @JoinColumn({ name: 'category_id' })
    category: Category | null;

    @Column({ type: 'text' })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @OneToMany(() => ProductVariant, (variant) => variant.product, {
        cascade: true, 
        eager: true,
    })
    variants: ProductVariant[];

    @Column({ type: 'varchar', length: 100, nullable: true })
    variant_type_name: string | null;


    @Column({ type: 'text', nullable: true })
    warranty: string | null;

    @Column({ default: true })
    is_active: boolean;

    @Column({ default: false })
    is_popular: boolean;

    @Column({ type: 'int', default: 0 })
    view_count: number;

    @Column({ type: 'int', default: 0 })
    search_count: number;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;

    @OneToMany(() => ProductImage, (image) => image.product, {
        cascade: true,
    })
    images: ProductImage[];

    @ManyToOne(() => Brand, (brand) => brand.products, {
        nullable: true,
        onDelete: "SET NULL",
    })
    @JoinColumn({ name: "brand_id" })
    brand: Brand | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    socket_type: string | null; 

    @Column({ type: 'varchar', length: 50, nullable: true })
    ram_type: string | null;

    @Column({ type: 'int', default: 0 })
    weight: number;

    @Column({ type: 'int', default: 0 })
    length: number;

    @Column({ type: 'int', default: 0 })
    width: number;

    @Column({ type: 'int', default: 0 })
    height: number;
}
