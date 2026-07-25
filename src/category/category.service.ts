import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { Category } from './entities/category.entity';
import { Product } from '../product/entities/product.entity';

import { ConflictException } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create.category.dto';
import { UpdateCategoryDto } from './dto/update.category.dto';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async createCategory(dto: CreateCategoryDto, imagePath?: string | null) {
    const existing = await this.categoryRepository.findOne({
      where: [{ name: dto.name }, { code: dto.code }],
    });

    if (existing) {
      throw new ConflictException('Category name or code already exists');
    }

    const category = this.categoryRepository.create({
      name: dto.name,
      code: dto.code,
      code_slug: this.slugify(dto.name),
      image_url: imagePath,
    });

    return this.categoryRepository.save(category);
  }

  async findAllCategory() {
    const categories = await this.categoryRepository
      .createQueryBuilder('category')
      .leftJoin('category.products', 'product')
      .leftJoin('category.grouping', 'grouping')
      .select([
        'category.id AS id',
        'category.name AS name',
        'category.code AS code',
        'category.image_url AS image_url',
        'grouping.id AS grouping_id',
        'grouping.name AS grouping_name',
        'COUNT(product.id) AS total_products',
      ])
      .groupBy('category.id')
      .addGroupBy('grouping.id')
      .orderBy('category.name', 'ASC')
      .getRawMany();

    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      code: cat.code,
      image_url: cat.image_url,
      grouping_id: cat.grouping_id,
      grouping_name: cat.grouping_name,
      total_products: Number(cat.total_products),
    }));
  }

  async findOneCategory(id: string) {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ['products', 'products.variants', 'grouping'],
    });

    if (!category) throw new NotFoundException('Category not found');

    return {
      id: category.id,
      name: category.name,
      code: category.code,
      image_url: category.image_url,
      grouping: category.grouping
        ? {
            id: category.grouping.id,
            name: category.grouping.name,
          }
        : null,
      total_products: category.products?.length || 0,
      products:
        category.products?.map((p) => {
          const defaultVariant =
            p.variants && p.variants.length > 0 ? p.variants[0] : null;

          const finalPrice =
            Number(defaultVariant?.price_normal || 0) -
            Number(defaultVariant?.price_discount || 0);

          return {
            id: p.id,
            name: p.name,
            final_price: finalPrice,
          };
        }) || [],
    };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, imagePath?: string) {
    const category = await this.categoryRepository.findOneBy({ id });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    category.name = dto.name ?? category.name;
    category.code = dto.code ?? category.code;

    if (imagePath) {
      category.image_url = imagePath;
    }

    return this.categoryRepository.save(category);
  }

  async deleteCategory(id: string): Promise<void> {
    const result = await this.categoryRepository.delete(id);
    if (result.affected === 0)
      throw new NotFoundException('Category not found');
  }
}
