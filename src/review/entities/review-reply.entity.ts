import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Review } from './review.entity';
import { User } from '../../user/entities/user.entity';

@Entity('review_replies')
export class ReviewReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Review, (review) => review.replies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review: Review;

  @Column()
  review_id: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'admin_id' })
  admin: User;

  @Column({ nullable: true })
  admin_id: string;

  @Column({ type: 'text' })
  comment: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}