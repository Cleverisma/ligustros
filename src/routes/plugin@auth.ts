import type { RequestHandler } from '@builder.io/qwik-city';

export const onRequest: RequestHandler = async (event) => {
  const { url, cookie } = event;

  const isLogin = url.pathname.startsWith('/login');
  
  // Exclude auth check on public static assets & build scripts
  const isAsset = url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|webp|ico|json|woff|woff2|ttf|eot)$/) !== null;
  const isBuildInfo = url.pathname.startsWith('/build/') || url.pathname.startsWith('/assets/');

  if (!isLogin && !isAsset && !isBuildInfo) {
    const adminSession = cookie.get('admin_session');
    
    if (!adminSession || adminSession.value !== 'authenticated_admin') {
      throw event.redirect(302, '/login');
    }
  } else if (isLogin) {
    const adminSession = cookie.get('admin_session');
    if (adminSession && adminSession.value === 'authenticated_admin') {
      throw event.redirect(302, '/');
    }
  }
};
