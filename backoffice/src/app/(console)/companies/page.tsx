import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Icon } from '@/components/Icon';
import { formatDate, formatNumber } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi, type Company } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { CompanyActions } from './CompanyActions';
import { NewCompanyButton } from './NewCompanyButton';

/** Aziende e domini (mockup 18a, D84): elenco, ricerca, nuova azienda, rimozione (18b). */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const current = await requireOperator('companies');
  const { q } = await searchParams;
  const search = (Array.isArray(q) ? q[0] : q)?.slice(0, 100) ?? '';
  const companies = await getAdminApi().listCompanies(current.token, search || undefined);
  const domains = companies.reduce((sum, company) => sum + company.domains.length, 0);

  return (
    <ConsoleShell current={current} active="companies">
      <PageHeader
        title={t('backoffice.title')}
        subtitle={t('backoffice.subtitle')}
        actions={<NewCompanyButton />}
      />
      <div className="toolbar">
        <form role="search" className="search" action="/companies">
          <label className="visually-hidden" htmlFor="company-search">
            {t('backoffice.search')}
          </label>
          <Icon name="search" />
          <input
            id="company-search"
            className="search__input"
            type="search"
            name="q"
            defaultValue={search}
            placeholder={t('backoffice.search')}
          />
        </form>
        <p className="toolbar__count" aria-live="polite">
          {t('backoffice.count.value', { companies: companies.length, domains })}
        </p>
      </div>
      <div className="sheet table-sheet">
        {companies.length === 0 ? (
          <p className="empty">{t('backoffice.empty.companies')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('backoffice.column.company')}</th>
                <th scope="col">{t('backoffice.column.domains')}</th>
                <th scope="col">{t('backoffice.column.users')}</th>
                <th scope="col">{t('backoffice.column.status')}</th>
                <th scope="col">{t('backoffice.column.edit')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('backoffice.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <CompanyRow key={company.id} company={company} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ConsoleShell>
  );
}

function CompanyRow({ company }: { company: Company }) {
  const removing = company.status === 'removing';
  return (
    <tr className={removing ? 'table__row--removing' : undefined}>
      <th scope="row" className="table__name">
        {company.name}
      </th>
      <td>
        {company.domains.map((domain) => (
          <span key={domain} className="domain">
            {domain}
          </span>
        ))}
      </td>
      <td className="table__number">
        {company.usersCount === null ? t('backoffice.under10') : formatNumber(company.usersCount)}
      </td>
      <td>
        <StatusPill company={company} />
      </td>
      <td className="table__number">{formatDate(new Date(company.updatedAt))}</td>
      <td>
        <CompanyActions companyId={company.id} name={company.name} removing={removing} />
      </td>
    </tr>
  );
}

function StatusPill({ company }: { company: Company }) {
  if (company.status === 'removing') {
    return (
      <span className="status status--removing">
        {t('backoffice.removing')}
        {company.removalFinalAt ? (
          <span className="status__detail">
            {t('backoffice.removing.until', { date: formatDate(new Date(company.removalFinalAt)) })}
          </span>
        ) : null}
      </span>
    );
  }
  if (company.isDemo) return <span className="status status--demo">{t('backoffice.demo')}</span>;
  return <span className="status status--active">{t('backoffice.active')}</span>;
}
