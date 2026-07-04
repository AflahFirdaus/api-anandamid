import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { diskStorage } from 'multer';
import { extname } from 'path';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  // ====================== PUBLIC ======================

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get reviews for a product' })
  async getByProduct(@Param('productId') productId: string) {
    return this.reviewService.findByProduct(productId);
  }

  @Get('product/:productId/summary')
  @ApiOperation({ summary: 'Get review summary (avg, total, distribution)' })
  async getSummary(@Param('productId') productId: string) {
    return this.reviewService.getProductSummary(productId);
  }

  // ====================== USER ======================

  @UseGuards(JwtUserGuard)
  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create review (user only)' })
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      storage: diskStorage({
        destination: './uploads/reviews',
        filename: (_req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `review-${uniqueSuffix}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
    }),
  )
  async create(
    @Req() req: any,
    @Body() dto: CreateReviewDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.reviewService.create(req.user.id, dto, files || []);
  }

  @UseGuards(JwtUserGuard)
  @Get('eligibility/:productId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Check if user can review a product' })
  async checkEligibility(
    @Req() req: any,
    @Param('productId') productId: string,
  ) {
    return this.reviewService.checkEligibility(req.user.id, productId);
  }

  // ====================== ADMIN ======================

  @UseGuards(JwtAuthGuard)
  @Get('pending')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get pending reviews (admin)' })
  async getPending() {
    return this.reviewService.findPending();
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/approve')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Approve a review (admin)' })
  async approve(@Param('id') id: string) {
    return this.reviewService.approve(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/reject')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Reject a review (admin)' })
  async reject(@Param('id') id: string) {
    return this.reviewService.reject(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/reply')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Reply to a review (admin)' })
  async reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateReplyDto,
  ) {
    return this.reviewService.createReply(id, req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('replies/:replyId')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a reply (admin)' })
  async deleteReply(@Param('replyId') replyId: string) {
    return this.reviewService.deleteReply(replyId);
  }
}