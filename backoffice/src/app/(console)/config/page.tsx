import { ActionDialog } from '@/components/ActionDialog';
import { ConsoleShell, PageHeader } from '@/components/ConsoleShell';
import { Note } from '@/components/ui';
import { TAXONOMY, limitLabel } from '@/lib/labels';
import { formatNumber } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi, type ConfigLimit } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { setTaxonomyItemAction, updateLimitAction } from './actions';

const UNIT = {
  hours: 'backoffice.config.unit.hours',
  days: 'backoffice.config.unit.days',
} as const;

/**
 * Configurazione (D89): limiti, tassonomie a tema ed elenco delle città. Le finestre di revisione
 * degli store sono nella sezione degli account dimostrativi.
 */
export default async function ConfigPage() {
  const current = await requireOperator('config');
  const config = await getAdminApi().getConfig(current.token);
  return (
    <ConsoleShell current={current} active="config">
      <PageHeader title={t('backoffice.config')} subtitle={t('backoffice.config.subtitle')} />
      <section className="sheet panel" aria-labelledby="limits-title">
        <h2 id="limits-title" className="panel__title">
          {t('backoffice.config.limits')}
        </h2>
        <Note icon="info">{t('backoffice.config.limits.note')}</Note>
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">{t('backoffice.config.parameter')}</th>
              <th scope="col">{t('backoffice.config.value')}</th>
              <th scope="col">
                <span className="visually-hidden">{t('backoffice.edit')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {config.limits.map((limit) => (
              <LimitRow key={limit.key} limit={limit} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="sheet panel" aria-labelledby="taxonomies-title">
        <h2 id="taxonomies-title" className="panel__title">
          {t('backoffice.config.taxonomies')}
        </h2>
        <Note icon="info">{t('backoffice.config.taxonomies.note')}</Note>
        {config.taxonomies.map((taxonomy) => (
          <div key={taxonomy.id} className="taxonomy">
            <h3 className="label-caps">{t(TAXONOMY[taxonomy.id])}</h3>
            <ul className="list">
              {taxonomy.items.map((item) => (
                <li key={item.key} className="list__item">
                  <span className="list__main mono">{item.key}</span>
                  <span className={`status status--${item.active ? 'active' : 'demo'}`}>
                    {t(item.active ? 'backoffice.active' : 'backoffice.config.inactive')}
                  </span>
                  <ActionDialog
                    action={setTaxonomyItemAction}
                    trigger={{
                      label: t(
                        item.active ? 'backoffice.config.deactivate' : 'backoffice.config.activate',
                      ),
                      variant: 'link',
                    }}
                    title={t(
                      item.active ? 'backoffice.config.deactivate' : 'backoffice.config.activate',
                    )}
                    effects={[t('backoffice.config.taxonomies.effect')]}
                    hidden={{ taxonomy: taxonomy.id, key: item.key, active: String(!item.active) }}
                    submitLabel={t('common.save')}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="sheet panel" aria-labelledby="cities-title">
        <h2 id="cities-title" className="panel__title">
          {t('backoffice.config.cities')}
        </h2>
        <p className="panel__body">
          {t('backoffice.config.cities.count', { count: formatNumber(config.citiesCount) })}
        </p>
      </section>
    </ConsoleShell>
  );
}

function LimitRow({ limit }: { limit: ConfigLimit }) {
  return (
    <tr>
      <th scope="row">{limitLabel(limit.key)}</th>
      <td className="table__number">
        {formatNumber(limit.value)}
        {limit.unit === 'count' ? null : ` ${t(UNIT[limit.unit])}`}
      </td>
      <td className="table__actions">
        <ActionDialog
          action={updateLimitAction}
          trigger={{ label: t('backoffice.edit'), variant: 'link' }}
          title={limitLabel(limit.key)}
          hidden={{ key: limit.key }}
          number={{
            name: 'value',
            label: t('backoffice.config.value.range', {
              min: formatNumber(limit.min),
              max: formatNumber(limit.max),
            }),
            min: limit.min,
            max: limit.max,
            defaultValue: limit.value,
          }}
          submitLabel={t('common.save')}
        />
      </td>
    </tr>
  );
}
