import Link from 'next/link';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { Button, Note, Select, TextInput } from '@/components/ui';
import { auditAction } from '@/lib/labels';
import { formatDateTime } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { auditQuery, readAuditFilter, type AuditParams } from './filter';

/**
 * Audit (D89, D99, D112): chi, cosa, quando e perché, con l'identificativo interno dell'oggetto e
 * senza dati personali; si conserva 12 mesi. Filtri nell'indirizzo, pagine con il cursore,
 * esportazione in CSV registrata a sua volta nell'audit.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditParams> }) {
  const current = await requireOperator('audit');
  const params = await searchParams;
  const filter = readAuditFilter(params);
  const page = await getAdminApi().listAudit(current.token, filter);
  const value = (key: string) => {
    const raw = params[key];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  return (
    <ConsoleShell current={current} active="audit">
      <PageHeader
        title={t('backoffice.audit')}
        subtitle={t('backoffice.audit.subtitle')}
        actions={
          <a
            href={`/audit/export${auditQuery(params)}`}
            className="button button--outline"
            download
          >
            <Icon name="download" />
            <span>{t('backoffice.audit.export')}</span>
          </a>
        }
      />
      <form className="sheet panel filters" action="/audit" role="search">
        <Select label={t('backoffice.audit.type')} name="type" defaultValue={value('type')}>
          <option value="">{t('backoffice.audit.type.all')}</option>
          <option value="action">{t('backoffice.audit.type.action')}</option>
          <option value="security">{t('backoffice.audit.type.security')}</option>
        </Select>
        <TextInput
          label={t('backoffice.audit.action')}
          name="action"
          defaultValue={value('action')}
          spellCheck={false}
          autoComplete="off"
        />
        <TextInput
          label={t('backoffice.audit.from')}
          name="from"
          type="date"
          defaultValue={value('from')}
        />
        <TextInput
          label={t('backoffice.audit.to')}
          name="to"
          type="date"
          defaultValue={value('to')}
        />
        <Button type="submit" icon="search">
          {t('backoffice.audit.filter')}
        </Button>
      </form>
      <Note icon="lock">{t('backoffice.audit.note')}</Note>
      <div className="sheet table-sheet">
        {page.items.length === 0 ? (
          <p className="empty">{t('backoffice.audit.empty')}</p>
        ) : (
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.audit.column.at')}</th>
                <th scope="col">{t('backoffice.audit.action')}</th>
                <th scope="col">{t('backoffice.audit.column.operator')}</th>
                <th scope="col">{t('backoffice.audit.column.subject')}</th>
                <th scope="col">{t('backoffice.removalModal.explanation')}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="table__number">{formatDateTime(new Date(entry.at))}</td>
                  <th scope="row">
                    {auditAction(entry.action)}
                    {entry.type === 'security' ? (
                      <span className="status status--removing">
                        {t('backoffice.audit.type.security')}
                      </span>
                    ) : null}
                  </th>
                  <td>{entry.operatorName ?? '—'}</td>
                  <td className="mono">{entry.subjectRef ?? '—'}</td>
                  <td>{entry.explanation ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {page.nextCursor ? (
        <Link
          href={`/audit${auditQuery(params, { cursor: page.nextCursor })}`}
          className="button button--link"
        >
          {t('backoffice.audit.older')}
        </Link>
      ) : null}
    </ConsoleShell>
  );
}
