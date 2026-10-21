/**
 * Esportazione dell'audit in CSV (D89, D197): solo l'Amministratore, con gli stessi filtri della
 * pagina; admin-api registra l'esportazione nell'audit. Il file non passa da nessuna cache.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { readAuditFilter } from '../filter';

export async function GET(request: NextRequest) {
  const { token } = await requireOperator('audit');
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  // L'esportazione copre tutto il periodo filtrato, non la sola pagina aperta.
  const filter = { ...readAuditFilter(params), cursor: undefined };
  const file = await getAdminApi().exportAudit(token, filter);
  const name = /^[\w.-]{1,80}$/.test(file.fileName) ? file.fileName : 'audit.csv';
  return new NextResponse(file.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
