import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import { ApiConsumes, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { Public } from '../../core/auth/scopes.decorator';
import { APP_CONFIG, AppConfig } from '../../infra/config/config';

/** Campi che Apple invia con `response_mode=form_post` (tutti facoltativi, nessuno si salva). */
export class AppleFormPostDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) id_token?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) state?: string;
  /** Nome ed email al primo accesso: non si usano (solo l'email del token, D224). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) user?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) error?: string;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const STATE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Ritorno del flusso web di Apple su Android e sul web (D228, Proposta 2): Apple invia il
 * risultato con `form_post` e la rotta lo passa all'app con un reindirizzamento all'indirizzo
 * dell'app (`APPLE_WEB_RETURN_URL`, di base `swipeandslide://auth/apple`). Nessun dato salvato:
 * il token va nel frammento dell'indirizzo, l'app controlla `state` e lo manda a `POST
 * /auth/apple`, dove il backend lo verifica con il `nonce` dell'app.
 */
@ApiTags('auth')
@Controller('auth/apple')
export class AppleWebCallbackController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Post('web-callback')
  @Public()
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiResponse({ status: 303, description: "Reindirizzamento all'app con il token nel frammento" })
  callback(@Body() body: AppleFormPostDto, @Res() res: Response): void {
    const params = new URLSearchParams();
    if (body.id_token && JWT.test(body.id_token) && body.state && STATE.test(body.state)) {
      params.set('id_token', body.id_token);
      params.set('state', body.state);
    } else {
      params.set('error', body.error === 'user_cancelled_authorize' ? 'cancelled' : 'invalid');
      if (body.state && STATE.test(body.state)) params.set('state', body.state);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(303, `${this.config.appleWebReturnUrl}#${params.toString()}`);
  }
}
