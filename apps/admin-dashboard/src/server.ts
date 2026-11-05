import handler from '@tanstack/react-start/server-entry';

declare global {
  interface Env {
    STATIC: Fetcher;
    TINYDESKAI: Fetcher;
    ADMIN_PASSWORD?: string;
    ADMIN_SECRET?: string;
  }
}

type AdminEnv = Env;

/**
 * 校验 HTTP Basic Auth
 */
function checkAuth(request: Request, expectedPassword?: string): Response | null {
  if (!expectedPassword) {
    // 未配置密码时，开发模式允许访问，生产模式拒绝
    if (import.meta.env.DEV) return null;
    return new Response('ADMIN_PASSWORD not configured', { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin Dashboard"' },
    });
  }

  try {
    const base64 = authHeader.slice(6);
    const decoded = atob(base64);
    const separator = decoded.indexOf(':');
    if (separator < 0) return new Response('Invalid Authorization header', { status: 400 });
    const password = decoded.slice(separator + 1);
    if (password !== expectedPassword) {
      return new Response('Forbidden', { status: 403 });
    }
  } catch {
    return new Response('Invalid Authorization header', { status: 400 });
  }

  return null;
}

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    // 静态资源放行
    const url = new URL(request.url);
    if (
      url.pathname.startsWith('/favicon') ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js')
    ) {
      return env.STATIC.fetch(request);
    }

    // 校验身份
    const authError = checkAuth(request, env.ADMIN_PASSWORD);
    if (authError) return authError;

    // 交给 TanStack Start 处理页面和 RPC 请求
    return handler.fetch(request);
  },
} satisfies ExportedHandler<AdminEnv>;
