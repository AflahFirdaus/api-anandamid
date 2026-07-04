import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Review } from './review.entity';

@Entity('review_images')
export class ReviewImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Review, (review) => review.images, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review: Review;

  @Column()
  review_id: string;

  @Column({ type: 'text' })
  image_url: string;

  @CreateDateColumn()
  created_at: Date;
}