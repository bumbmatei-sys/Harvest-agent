import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Resolve a custom domain to a tenantId using Firestore REST API.
 * No firebase-admin SDK needed — uses the web API key.
 * Looks up the 'domains' collection by document ID (the domain string).
 * Called by middleware when hostname doesn't match known base domains.
 */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain');
  const redirectPath = request.nextUrl.searchParams.get('redirect') || '/';
  
  if (!domain) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  try {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    // Firebase project ID — hardcoded for now (single project deployment)
    const projectId = 'harvest-agent-233a1';
    
    // Normalize domain: lowercase, strip www. prefix for lookup
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    // Try exact match on domains collection (simple GET, only needs API key)
    let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/domains/${normalizedDomain}?key=${apiKey}`;
    let resp = await fetch(url);

    if (!resp.ok) {
      // Try with www prefix in case that's how it was stored
      url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/domains/www.${normalizedDomain}?key=${apiKey}`;
      resp = await fetch(url);
    }

    if (!resp.ok) {
      return NextResponse.redirect(new URL('https://theharvest.app', request.url));
    }

    const doc = await resp.json();
    const tenantId = doc.fields?.tenantId?.stringValue;

    if (!tenantId) {
      return NextResponse.redirect(new URL('https://theharvest.app', request.url));
    }

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
