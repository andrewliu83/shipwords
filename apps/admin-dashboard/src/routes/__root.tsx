import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
      },
    ],
  }),
  shellComponent: Document,
  component: Layout,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full bg-slate-950 text-slate-100 font-sans">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          code, pre {
            font-family: 'JetBrains Mono', monospace;
          }
        `}} />
      </head>
      <body className="h-full flex flex-col antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
      {/* 侧边导航栏 */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
          <div className="w-6 h-6 rounded bg-indigo-500 flex items-center justify-center font-bold text-xs text-white">
            S
          </div>
          <span className="font-semibold text-white tracking-wide">Shipwords Admin</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          <Link
            to="/"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>📊</span>
            <span>仪表盘</span>
          </Link>
          <Link
            to="/users"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>👥</span>
            <span>用户管理</span>
          </Link>
          <Link
            to="/credits"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>💳</span>
            <span>积分账本</span>
          </Link>
          <Link
            to="/jobs"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>⚙️</span>
            <span>生成任务</span>
          </Link>
          <Link
            to="/billing"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>💰</span>
            <span>支付记录</span>
          </Link>
          <Link
            to="/quota"
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 [&.active]:bg-indigo-600 [&.active]:text-white transition-colors"
          >
            <span>🛡️</span>
            <span>访客配额</span>
          </Link>
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-500">
          <p>Shipwords Admin v0.1</p>
          <p className="mt-1">多站点聚合面板</p>
        </div>
      </aside>

      {/* 主展示区 */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/20">
          <div className="text-sm text-slate-400">
            环境: <span className="text-emerald-400 font-mono">生产/预览</span>
          </div>
          <div className="text-sm font-mono text-slate-400">
            {new Date().toLocaleDateString('zh-CN')}
          </div>
        </header>

        <div className="flex-1 p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
