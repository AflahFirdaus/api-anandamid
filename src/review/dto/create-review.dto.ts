import { IsNotEmpty, IsInt, Min, Max, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @IsNotEmpty()
  @IsString()
  product_id: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}