import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health(): { ok: boolean; service: string } {
    return { ok: true, service: 'decant-api' };
  }
}
