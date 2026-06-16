import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cert, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Resolve a custom domain to a tenantId.
 * Called by middleware when hostname doesn't match known base domains.
 * Sets tenantId + customDomain cookies and redirects to the original URL.
 */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain');
  const redirectPath = request.nextUrl.searchParams.get('redirect') || '/';
  
  if (!domain) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  try {
    if (!getApps().length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
      initializeApp({ credential: cert(serviceAccount) });
    }

    const db = getFirestore();
    
    // Query tenants collection for matching custom domain
    const snapshot = await db.collection('tenants')
      .where('config.customDomain', '==', domain)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Domain not found — redirect to main site
      return NextResponse.redirect(new URL('https://theharvest.app', request.url));
    }

    const tenant = snapshot.docs[0];
    const tenantId = tenant.id;

    // Redirect to the original path with tenant context cookies
    const redirectUrl = new URL(redirectPath, request.url);
    const response = NextResponse.redirect(redirectUrl);
    
    response.cookies.set('tenantId', tenantId, { 
      path: '/', 
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
    response.cookies.set('customDomain', domain, { 
      path: '/', 
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });

    return response;
  } catch (error) {
    console.error('Domain resolution error:', error);
    return NextResponse.redirect(new URL('https://theharvest.app', request.url));
  }
}
