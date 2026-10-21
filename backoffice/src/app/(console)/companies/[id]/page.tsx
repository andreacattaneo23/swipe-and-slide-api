import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { formatDate, formatNumber } from '@/lib/time';
import { t } from '@/texts';
import { AdminApiError, getAdminApi, type Company } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { addDomainAction, removeDomainAction, renameCompanyAction } from '../actions';
import { ChangeDialogButton } from '../ChangeDialog';

/**
 * Modifica di un'azienda (D84, D89, D94): nome, domini, spostamento di un dominio verso un'altra
 * azienda e fusione. Ogni azione ha la motivazione e resta nell'audit; spostamenti e fusioni
 * passano dall'anteprima con i soli conteggi e non mescolano aziende reali e dimostrative (D42).
 */
export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireOperator('companies');
  const { id } = await params;
  const api = getAdminApi();
  let company: Company;
  try {
    company = await api.getCompany(current.token, id);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'not_found') notFound();
    throw error;
  }
  const targets = (await api.listCompanies(current.token))
    .filter((item) => item.id !== company.id && item.status === 'active')
    .filter((item) => item.isDemo === company.isDemo)
    .map((item) => ({ id: item.id, name: item.name }));
  const editable = company.status === 'active';

  return (
    <ConsoleShell current={current} active="companies">
      <Link href="/companies" className="back-link">
        <Icon name="arrowLeft" size={16} />
        <span>{t('backoffice.companies')}</span>
      </Link>
      <PageHeader
        title={company.name}
        subtitle={t('backoffice.company.subtitle', {
          users:
            company.usersCount === null
              ? t('backoffice.under10')
              : formatNumber(company.usersCount),
          date: formatDate(new Date(company.updatedAt)),
        })}
        actions={
          editable ? (
            <ActionDialog
              action={renameCompanyAction}
              trigger={{ label: t('backoffice.company.rename'), icon: 'pencil' }}
              title={t('backoffice.company.rename')}
              hidden={{ companyId: company.id }}
              inputs={[
                { name: 'name', label: t('backoffice.column.company'), defaultValue: company.name },
              ]}
              submitLabel={t('common.save')}
            />
          ) : null
        }
      />
      {company.isDemo ? <p className="status status--demo">{t('backoffice.demo')}</p> : null}
      {!editable ? (
        <p className="form-message form-message--error" role="status">
          {t('backoffice.company.notEditable')}
        </p>
      ) : null}

      <section className="sheet panel" aria-labelledby="domains-title">
        <div className="panel__head">
          <h2 id="domains-title" className="panel__title">
            {t('backoffice.column.domains')}
          </h2>
          {editable ? (
            <ActionDialog
              action={addDomainAction}
              trigger={{ label: t('backoffice.company.addDomain'), icon: 'plus' }}
              title={t('backoffice.company.addDomain')}
              hidden={{ companyId: company.id }}
              inputs={[
                {
                  name: 'domain',
                  label: t('backoffice.company.domain'),
                  hint: t('backoffice.newCompany.domains.hint'),
                },
              ]}
              submitLabel={t('common.add')}
            />
          ) : null}
        </div>
        <ul className="domain-list">
          {company.domains.map((domain) => (
            <li key={domain} className="domain-list__item">
              <span className="domain">{domain}</span>
              {editable ? (
                <span className="domain-list__actions">
                  <ChangeDialogButton
                    kind="move"
                    companyId={company.id}
                    domain={domain}
                    targets={targets}
                    label={t('backoffice.company.move')}
                    title={t('backoffice.company.move.title', { domain })}
                    expectedName={domain}
                  />
                  {company.domains.length > 1 ? (
                    <ActionDialog
                      action={removeDomainAction}
                      trigger={{ label: t('backoffice.company.removeDomain'), variant: 'link' }}
                      title={t('backoffice.company.removeDomain.title', { domain })}
                      effects={[t('backoffice.company.removeDomain.effect')]}
                      hidden={{ companyId: company.id, domain }}
                      destructive
                      submitLabel={t('backoffice.company.removeDomain')}
                    />
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {editable && targets.length > 0 ? (
        <section className="sheet panel" aria-labelledby="merge-title">
          <h2 id="merge-title" className="panel__title">
            {t('backoffice.company.merge')}
          </h2>
          <p className="panel__body">
            {t('backoffice.company.merge.body', { name: company.name })}
          </p>
          <ChangeDialogButton
            kind="merge"
            companyId={company.id}
            targets={targets}
            label={t('backoffice.company.merge')}
            title={t('backoffice.company.merge.title', { name: company.name })}
            expectedName={company.name}
          />
        </section>
      ) : null}
    </ConsoleShell>
  );
}
