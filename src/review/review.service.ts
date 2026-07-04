import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review, ReviewStatus } from './entities/review.entity';
import { ReviewImage } from './entities/review-image.entity';
import { ReviewReply } from './entities/review-reply.entity';
import { Order } from '../order/entities/order.entity';
import { Product } from '../product/entities/product.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ReviewService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewImage)
    private readonly reviewImageRepo: Repository<ReviewImage>,
    @InjectRepository(ReviewReply)
    private readonly reviewReplyRepo: Repository<ReviewReply>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  // ====================== PUBLIC ======================

  async findByProduct(productId: string) {
    const reviews = await this.reviewRepo.find({
      where: { product_id: productId, status: ReviewStatus.APPROVED },
      relations: ['user', 'images', 'replies', 'replies.admin'],
      order: { created_at: 'DESC' },
    });

    const summary = await this.getProductSummary(productId);

    return {
      summary,
      data: reviews.map((r) => ({
        id: r.id,
        user: {
          id: r.user?.id,
          full_name: r.user?.full_name,
          avatar_url: r.user?.avatar_url,
        },
        rating: r.rating,
        comment: r.comment,
        images: r.images?.map((img) => img.image_url) || [],
        reply: r.replies?.[0]
          ? {
              comment: r.replies[0].comment,
              admin_name: r.replies[0].admin?.full_name || 'Admin',
              created_at: r.replies[0].created_at,
            }
          : null,
        created_at: r.created_at,
      })),
    };
  }

  async getProductSummary(productId: string) {
    const result = await this.reviewRepo
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avg')
      .addSelect('COUNT(review.id)', 'total')
      .addSelect(
        "COUNT(CASE WHEN review.rating = 5 THEN 1 END)",
        'five',
      )
      .addSelect(
        "COUNT(CASE WHEN review.rating = 4 THEN 1 END)",
        'four',
      )
      .addSelect(
        "COUNT(CASE WHEN review.rating = 3 THEN 1 END)",
        'three',
      )
      .addSelect(
        "COUNT(CASE WHEN review.rating = 2 THEN 1 END)",
        'two',
      )
      .addSelect(
        "COUNT(CASE WHEN review.rating = 1 THEN 1 END)",
        'one',
      )
      .where('review.product_id = :pid', { pid: productId })
      .andWhere('review.status = :status', { status: ReviewStatus.APPROVED })
      .getRawOne();

    return {
      average_rating: result?.avg ? Math.round(Number(result.avg) * 10) / 10 : 0,
      total_reviews: Number(result?.total || 0),
      distribution: {
        5: Number(result?.five || 0),
        4: Number(result?.four || 0),
        3: Number(result?.three || 0),
        2: Number(result?.two || 0),
        1: Number(result?.one || 0),
      },
    };
  }

  // ====================== USER ======================

  async create(
    userId: string,
    dto: CreateReviewDto,
    files: Express.Multer.File[],
  ) {
    // 1. Cek produk exists
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id },
    });
    if (!product) {
      throw new NotFoundException('Produk tidak ditemukan');
    }

    // 2. Cek user sudah beli dan order SELESAI
    const completedOrder = await this.orderRepo
      .createQueryBuilder('order')
      .leftJoin('order.items', 'item')
      .where('order.user_id = :userId', { userId })
      .andWhere('order.status = :status', { status: 'SELESAI' })
      .andWhere('item.product_id = :productId', { productId: dto.product_id })
      .getOne();

    if (!completedOrder) {
      throw new BadRequestException(
        'Anda hanya dapat mereview produk yang sudah dibeli dan order selesai',
      );
    }

    // 3. Cek user belum pernah review produk ini
    const existing = await this.reviewRepo.findOne({
      where: { user_id: userId, product_id: dto.product_id },
    });
    if (existing) {
      throw new BadRequestException(
        'Anda sudah mereview produk ini sebelumnya',
      );
    }

    // 4. Validasi jumlah foto
    if (files && files.length > 5) {
      throw new BadRequestException('Maksimal 5 foto');
    }

    // 5. Simpan review
    const review = this.reviewRepo.create({
      product_id: dto.product_id,
      user_id: userId,
      order_id: completedOrder.id,
      rating: dto.rating,
      comment: dto.comment || '',
      status: ReviewStatus.PENDING,
    });

    const savedReview = await this.reviewRepo.save(review);

    // 6. Simpan gambar
    if (files && files.length > 0) {
      const images = files.map((file) =>
        this.reviewImageRepo.create({
          review_id: savedReview.id,
          image_url: `/uploads/reviews/${file.filename}`,
        }),
      );
      await this.reviewImageRepo.save(images);
    }

    return {
      message:
        'Review berhasil dikirim dan menunggu persetujuan admin',
      review: { id: savedReview.id, status: savedReview.status },
    };
  }

  async checkEligibility(userId: string, productId: string) {
    // Cek sudah beli & SELESAI
    const completedOrder = await this.orderRepo
      .createQueryBuilder('order')
      .leftJoin('order.items', 'item')
      .where('order.user_id = :userId', { userId })
      .andWhere('order.status = :status', { status: 'SELESAI' })
      .andWhere('item.product_id = :productId', { productId })
      .getOne();

    if (!completedOrder) {
      return {
        eligible: false,
        reason: 'Anda hanya dapat mereview produk yang sudah dibeli dan order selesai',
      };
    }

    // Cek belum review
    const existing = await this.reviewRepo.findOne({
      where: { user_id: userId, product_id: productId },
    });
    if (existing) {
      return {
        eligible: false,
        reason: 'Anda sudah mereview produk ini sebelumnya',
      };
    }

    return { eligible: true };
  }

  // ====================== ADMIN ======================

  async findPending() {
    return this.reviewRepo.find({
      where: { status: ReviewStatus.PENDING },
      relations: ['user', 'product', 'images'],
      order: { created_at: 'DESC' },
    });
  }

  async approve(reviewId: string) {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review tidak ditemukan');
    }
    if (review.status !== ReviewStatus.PENDING) {
      throw new BadRequestException('Hanya review PENDING yang bisa disetujui');
    }
    review.status = ReviewStatus.APPROVED;
    await this.reviewRepo.save(review);
    return { message: 'Review disetujui' };
  }

  async reject(reviewId: string) {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review tidak ditemukan');
    }
    if (review.status !== ReviewStatus.PENDING) {
      throw new BadRequestException('Hanya review PENDING yang bisa ditolak');
    }
    review.status = ReviewStatus.REJECTED;

    // Hapus gambar dari disk
    if (review.images && review.images.length > 0) {
      for (const img of review.images) {
        const filePath = path.join(
          process.cwd(),
          'uploads',
          'reviews',
          path.basename(img.image_url),
        );
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    await this.reviewRepo.save(review);
    return { message: 'Review ditolak' };
  }

  async createReply(
    reviewId: string,
    adminId: string,
    dto: CreateReplyDto,
  ) {
    const review = await this.reviewRepo.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review tidak ditemukan');
    }
    if (review.status !== ReviewStatus.APPROVED) {
      throw new BadRequestException(
        'Hanya review APPROVED yang bisa dibalas',
      );
    }

    // Cek sudah ada reply
    const existingReply = await this.reviewReplyRepo.findOne({
      where: { review_id: reviewId },
    });
    if (existingReply) {
      throw new BadRequestException('Review ini sudah memiliki balasan');
    }

    const reply = this.reviewReplyRepo.create({
      review_id: reviewId,
      admin_id: adminId,
      comment: dto.comment,
    });
    await this.reviewReplyRepo.save(reply);

    return { message: 'Balasan berhasil dikirim' };
  }

  async deleteReply(replyId: string) {
    const reply = await this.reviewReplyRepo.findOne({
      where: { id: replyId },
    });
    if (!reply) {
      throw new NotFoundException('Balasan tidak ditemukan');
    }
    await this.reviewReplyRepo.remove(reply);
    return { message: 'Balasan dihapus' };
  }
}