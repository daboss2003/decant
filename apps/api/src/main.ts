import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BearerGuard } from './auth.guard';
import { RateLimitGuard } from './rate-limit.guard';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.enableCors(); // the Next.js review UI calls this API from the browser
  // Open API: rate-limit every request; bearer auth stays optional (off unless API_AUTH_TOKEN set).
  app.useGlobalGuards(new RateLimitGuard(), new BearerGuard());
  const port = Number(process.env.PORT ?? 3001); // PORT=0 → ephemeral (used by tests)
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
  const addr = app.getHttpServer().address();
  const bound = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`API_LISTENING ${bound}`); // machine-readable (tests parse this)
  console.error(`Decant REST API ready (http://127.0.0.1:${bound})${process.env.API_AUTH_TOKEN ? ', bearer-guarded' : ''}.`);
}

void bootstrap();
