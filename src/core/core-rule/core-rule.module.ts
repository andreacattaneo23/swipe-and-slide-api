import { Global, Module } from '@nestjs/common';
import { CoreRuleService } from './core-rule.service';
import { VisibilityGuard } from './visibility.guard';

@Global()
@Module({
  providers: [CoreRuleService, VisibilityGuard],
  exports: [CoreRuleService, VisibilityGuard],
})
export class CoreRuleModule {}
