import { 
  Controller, Post, Get, Put, Delete, Patch, 
  Body, Req, UseGuards, UseInterceptors, 
  UploadedFile, BadRequestException, Param, Query 
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtUserGuard } from './guards/jwt-user.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guards';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { GoogleRegisterPhoneDto } from './dto/google-register-phone.dto';
import { UpdatePhoneDto } from './dto/update-phone.dto';

@Controller('user/auth')
export class UserController {
    constructor(private readonly userService: UserService) {}

    // ================= AUTH ENDPOINTS =================

    @UseGuards(JwtUserGuard)
    @Put('change-password')
    async changePassword(@Req() req: any, @Body() body: any) {
        return this.userService.changePassword(req.user.id, body);
    }

    @Post('register')
    async register(@Body() body: RegisterDto) {
        return this.userService.register(body);
    }

    @Post('login')
    async login(@Body() body: LoginDto) {
        return this.userService.login(body.email, body.password);
    }

    @UseGuards(JwtUserGuard)
    @Post('logout')
    async logout(@Req() req: any) {
        return this.userService.logout(req.user.id);
    }

    @Post('refresh')
    async refresh(@Body() body: any) {
        return this.userService.refresh(body.refresh_token);
    }

    @Post('google')
    async googleLogin(@Body('token') token: string) {
        return this.userService.googleLogin(token);
    }

    @Post('verify-otp')
    async verifyOtp(@Body() body: VerifyOtpDto) {
        return this.userService.verifyOtp(body.phone_number, body.otp);
    }

    @Post('resend-otp')
    async resendOtp(@Body() body: ResendOtpDto) {
        return this.userService.resendOtp(body.phone_number);
    }

    @Post('google-register-phone')
    async googleRegisterPhone(@Body() body: GoogleRegisterPhoneDto) {
        return this.userService.googleRegisterPhone(body);
    }

    @Post('update-phone')
    async updatePhone(@Body() body: UpdatePhoneDto) {
        return this.userService.updatePhone(body.current_phone, body.new_phone);
    }

    // ================= PROFILE ENDPOINTS =================
    
    @UseGuards(JwtUserGuard)
    @Get('profile')
    async getProfile(@Req() req: any) {
        return this.userService.getProfile(req.user.id);
    }

    @UseGuards(JwtUserGuard)
    @Put('profile')
    async updateProfile(@Req() req: any, @Body() body: any) {
        return this.userService.updateProfile(req.user.id, body);
    }

    // ================= ADDRESS ENDPOINTS =================

    @UseGuards(JwtUserGuard)
    @Get('addresses')
    async getMyAddresses(@Req() req: any) {
        return this.userService.getMyAddresses(req.user.id);
    }

    @UseGuards(JwtUserGuard)
    @Post('addresses')
    async addAddress(@Req() req: any, @Body() dto: any) {
        return this.userService.addAddress(req.user.id, dto);
    }

    @UseGuards(JwtUserGuard)
    @Put('addresses/:id')
    async updateAddress(@Req() req: any, @Param('id') addressId: string, @Body() dto: any) {
        return this.userService.addAddress(req.user.id, { ...dto, id: addressId });
    }

    @UseGuards(JwtUserGuard)
    @Patch('addresses/:id/default')
    async setDefaultAddress(@Req() req: any, @Param('id') addressId: string) {
        return this.userService.setDefaultAddress(req.user.id, addressId);
    }

    @UseGuards(JwtUserGuard)
    @Delete('addresses/:id')
    async deleteAddress(@Req() req: any, @Param('id') addressId: string) {
        return this.userService.deleteAddress(req.user.id, addressId);
    }

    // ================= UPLOAD AVATAR ENDPOINT =================
    @UseGuards(JwtUserGuard)
    @Post('profile/avatar')
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './uploads', 
            filename: (req: any, file, cb) => { 
                const userId = req.user?.id || 'unknown'; 
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const ext = extname(file.originalname);
                cb(null, `avatar-${userId}-${uniqueSuffix}${ext}`);
            },
        }),
        fileFilter: (req: any, file, cb) => { 
            if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
                return cb(new BadRequestException('Hanya file gambar yang diizinkan!'), false);
            }
            cb(null, true);
        },
        limits: { fileSize: 2 * 1024 * 1024 }, 
    }))
    async uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('File tidak ditemukan');
        }

        const fileUrl = `/uploads/${file.filename}`;
        return this.userService.updateAvatar(req.user.id, fileUrl);
    }

    @Post('forgot-password')
    async forgotPassword(@Body('email') email: string) {
        return this.userService.forgotPassword(email);
    }

    @Post('forgot-password-otp')
    async forgotPasswordOtp(@Body('phone_number') phone_number: string) {
        return this.userService.forgotPasswordOtp(phone_number);
    }

    @Post('verify-forgot-password-otp')
    async verifyForgotPasswordOtp(@Body() body: any) {
        return this.userService.verifyForgotPasswordOtp(body.phone_number, body.otp, body.new_password);
    }

    @Post('reset-password')
    async resetPassword(@Body() body: any) {
        return this.userService.resetPassword(body.token, body.password);
    }

    @UseGuards(JwtAuthGuard)
    @Get('admin/all')
    async getAllUsers(@Query() query: any) {
        return this.userService.getAllUsers(query);
    }

    @UseGuards(JwtAuthGuard)
    @Get('admin/:id')
    async getUserById(@Param('id') id: string) {
        return this.userService.getUserById(id);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('admin/:id/toggle-active')
    async toggleUserActive(@Param('id') id: string) {
        return this.userService.toggleUserActive(id);
    }
}