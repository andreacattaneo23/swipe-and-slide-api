import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthContext } from '../../core/auth/auth-context';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { Scopes } from '../../core/auth/scopes.decorator';
import { ExposesUser } from '../../core/core-rule/exposes-user.decorator';
import { PhotosService } from '../../domain/photos/photos.service';
import { ProfileViewService } from '../../domain/profiles/profile-view.service';
import { ProfilesService } from '../../domain/profiles/profiles.service';
import { TaxonomiesService } from '../../domain/taxonomies/taxonomies.service';
import { PeopleService } from '../feed-chat/people.service';
import {
  AnswersDto,
  InterestsDto,
  OwnPhotoDto,
  OwnProfileDto,
  PhotoOrderDto,
  PhotoUploadDto,
  ProfileDeckDto,
  ProfilePatchDto,
  TaxonomiesDto,
} from './profile.dto';

/** Chi può modificare il profilo: registrazione (foto), approvazione e account attivi (D141). */
const EDIT_SCOPES = ['approval', 'full'] as const;

/** Profilo dell'utente stesso, foto, tassonomie e profilo nel dettaglio di un'altra persona. */
@ApiTags('profile')
@ApiBearerAuth()
@Controller()
export class ProfileController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly photos: PhotosService,
    private readonly views: ProfileViewService,
    private readonly taxonomies: TaxonomiesService,
    private readonly people: PeopleService,
  ) {}

  /** Tassonomie a tema con le etichette correnti: `ETag` e cache pubblica (D231). */
  @Get('taxonomies')
  @Scopes('registration', 'approval', 'full', 'restore', 'limited')
  @ApiOkResponse({ type: TaxonomiesDto })
  async taxonomiesList(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TaxonomiesDto | undefined> {
    const { value, etag } = await this.taxonomies.all();
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return value;
  }

  @Get('me/profile')
  @Scopes('registration', ...EDIT_SCOPES, 'restore', 'limited')
  @ApiOkResponse({ type: OwnProfileDto })
  getOwn(@CurrentUser() me: AuthContext): Promise<OwnProfileDto> {
    return this.profiles.getOwn(me.userId);
  }

  @Patch('me/profile')
  @Scopes(...EDIT_SCOPES)
  @ApiOkResponse({ type: OwnProfileDto })
  update(@CurrentUser() me: AuthContext, @Body() body: ProfilePatchDto): Promise<OwnProfileDto> {
    return this.profiles.update(me.userId, body);
  }

  @Put('me/profile/interests')
  @Scopes(...EDIT_SCOPES)
  @ApiOkResponse({ type: OwnProfileDto })
  interests(@CurrentUser() me: AuthContext, @Body() body: InterestsDto): Promise<OwnProfileDto> {
    return this.profiles.setInterests(me.userId, body.interests);
  }

  @Put('me/profile/answers')
  @Scopes(...EDIT_SCOPES)
  @ApiOkResponse({ type: OwnProfileDto })
  answers(@CurrentUser() me: AuthContext, @Body() body: AnswersDto): Promise<OwnProfileDto> {
    return this.profiles.setAnswers(me.userId, body.answers);
  }

  @Get('me/photos')
  @Scopes('registration', ...EDIT_SCOPES, 'restore', 'limited')
  @ApiOkResponse({ type: OwnPhotoDto, isArray: true })
  listPhotos(@CurrentUser() me: AuthContext): Promise<OwnPhotoDto[]> {
    return this.photos.listOwn(me.userId);
  }

  /** Nuova foto: URL firmato per caricarla nell'area temporanea, poi la conferma. */
  @Post('me/photos')
  @Scopes('registration', ...EDIT_SCOPES)
  @ApiOkResponse({ type: PhotoUploadDto })
  createPhoto(@CurrentUser() me: AuthContext): Promise<PhotoUploadDto> {
    return this.photos.createUpload(me.userId);
  }

  @Post('me/photos/:id/confirm')
  @Scopes('registration', ...EDIT_SCOPES)
  @HttpCode(200)
  @ApiOkResponse({ type: OwnPhotoDto })
  confirmPhoto(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OwnPhotoDto> {
    return this.photos.confirm(me.userId, id);
  }

  @Patch('me/photos/order')
  @Scopes('registration', ...EDIT_SCOPES)
  @ApiOkResponse({ type: OwnPhotoDto, isArray: true })
  reorder(@CurrentUser() me: AuthContext, @Body() body: PhotoOrderDto): Promise<OwnPhotoDto[]> {
    return this.photos.reorder(me.userId, body.photoIds);
  }

  /** Foto cancellata subito, anche dall'archivio (D83). */
  @Delete('me/photos/:id')
  @Scopes('registration', ...EDIT_SCOPES, 'restore', 'limited')
  @HttpCode(204)
  @ApiNoContentResponse()
  async removePhoto(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.photos.remove(me.userId, id);
  }

  /**
   * Profilo dal feed (deck), senza azienda né cognome: regola `interact` (D31, RC-60), con la
   * fascia di distanza e l'escalation ricevuta del feed (D49, D53).
   */
  @Get('profiles/:id')
  @Scopes('full')
  @ExposesUser({ rule: 'interact' })
  @ApiOkResponse({ type: ProfileDeckDto })
  async profile(
    @CurrentUser() me: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ProfileDeckDto> {
    const deck = await this.views.fromFeed(me.userId, id);
    return { ...deck, ...(await this.people.feedExtras(me.userId, id)) };
  }
}
