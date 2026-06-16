import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Resolve a custom domain to a tenantId using Firestore REST API.
 * No firebase-admin SDK needed — uses the web API key.
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
    const projectId = 'harvest-agent-233a1';
    
    // Use Firestore REST API to query tenants by customDomain
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
    
    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: 'tenants' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'config.customDomain' },
                  op: 'EQUAL',
                  value: { stringValue: domain }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'status' },
                  op: 'EQUAL',
                  value: { stringValue: 'active' }
                }
              }
            ]
          }
        },
        limit: 1
      }
    };

    const resp = await fetch(`${url}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    });

    if (!resp.ok) {
      throw new Error(`Firestore REST API error: ${resp.status}`);
    }

    const data = await resp.json();
    
    // Check if we got a result
    if (!data || data.length === 0 || !data[0].document) {
      return NextResponse.redirect(new URL('https://theharvest.app', request.url));
    }

    // Extract tenantId from document name: projects/.../tenants/{tenantId}
    const docName = data[0].document.name;
    const tenantId = docName.split('/').pop();

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
