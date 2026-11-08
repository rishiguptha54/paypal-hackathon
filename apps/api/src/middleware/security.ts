import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

const PAYPAL_HOSTS = [
  'https://www.sandbox.paypal.com',
  'https://www.paypal.com',
  'https://*.paypal.com',
];

/** HTTP security headers from spec/security.md section 5. */
export function securityHeaders(isProduction: boolean): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", ...PAYPAL_HOSTS],
          'frame-src': PAYPAL_HOSTS,
          'connect-src': ["'self'", 'https://www.sandbox.paypal.com', 'https://*.paypal.com'],
          'img-src': ["'self'", 'data:', 'https:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      strictTransportSecurity: isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      xContentTypeOptions: true,
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // The PayPal checkout popup needs window.opener, which plain same-origin would sever.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginEmbedderPolicy: false,
    }),
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com")',
      );
      next();
    },
  ];
}
