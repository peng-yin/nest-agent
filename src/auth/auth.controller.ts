import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { z } from 'zod';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  tenantId: z.string().min(1),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: any) {
    const dto = RegisterSchema.parse(body);
    return this.authService.register(dto.email, dto.password, dto.name, dto.tenantId);
  }

  @Post('login')
  async login(@Body() body: any) {
    const dto = LoginSchema.parse(body);
    return this.authService.login(dto.email, dto.password);
  }
}
