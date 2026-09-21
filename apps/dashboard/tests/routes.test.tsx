import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import CasesPage from '@/app/cases/page';
import CaseDetailPage from '@/app/cases/[caseId]/page';
import MerchantsPage from '@/app/merchants/page';
import ReviewPage from '@/app/review/page';
import ErrorState from '@/app/error';
import Loading from '@/app/loading';
import { DataSourceError, type DataProvider } from '@/lib/data/provider';
import { setDataProvider } from '@/lib/data/adapter';
import { fixturesProvider } from '@/lib/data/fixtures-provider';

afterEach(() => setDataProvider(undefined));

/** A live-looking provider: starts as the fixtures, then is mutated like the backend would be. */
function live(overrides: Partial<DataProvider> = {}): DataProvider {
  return { ...fixturesProvider, source: 'aws', ...overrides };
}

describe('live-data route behaviour', () => {
  it('shows a newly processed case in the list and a placeholder until its report exists', async () => {
    const [first] = await fixturesProvider.listCases();
    const fresh = { ...first, caseId: 'case_new_live', updatedAt: '2099-01-01T00:00:00Z' };
    setDataProvider(live({
      listCases: async () => [...(await fixturesProvider.listCases()), fresh],
      getCase: async (id) => (id === fresh.caseId ? fresh : fixturesProvider.getCase(id)),
      getCaseReport: async (id) => (id === fresh.caseId ? undefined : fixturesProvider.getCaseReport(id)),
    }));
    render(await CasesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('case_new_live')).toBeInTheDocument();
    render(await CaseDetailPage({ params: Promise.resolve({ caseId: 'case_new_live' }) }));
    expect(screen.getByText(/report has not been generated yet/i)).toBeInTheDocument();
  });

  it('shows updated merchant intelligence on the merchants page', async () => {
    const [m] = await fixturesProvider.listMerchantProfiles();
    setDataProvider(live({ listMerchantProfiles: async () => [{ ...m, canonicalName: 'Freshly Researched Co' }] }));
    render(await MerchantsPage());
    expect(screen.getByText('Freshly Researched Co')).toBeInTheDocument();
  });

  it('renders a stale-data notice when the provider is serving a last-known-good copy', async () => {
    setDataProvider(live({ status: () => ({ source: 'aws', stale: true, staleSince: '2026-09-20T12:00:00Z', skippedRecords: 0 }) }));
    render(await CasesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('status')).toHaveTextContent(/stale data/i);
  });

  it('notes records hidden for failing validation, and stays silent for healthy data', async () => {
    setDataProvider(live({ status: () => ({ source: 'aws', stale: false, skippedRecords: 2 }) }));
    const { unmount } = render(await ReviewPage());
    expect(screen.getByRole('status')).toHaveTextContent('2 record(s) hidden');
    unmount();
    setDataProvider(undefined);
    render(await ReviewPage());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('distinguishes an empty ledger from an empty filter result, and empty review/merchant lists', async () => {
    setDataProvider(live({
      listCases: async () => [], listMerchantProfiles: async () => [], listHumanReviewRequests: async () => [],
    }));
    const cases = render(await CasesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText('No cases on record yet.')).toBeInTheDocument();
    cases.unmount();
    const merchants = render(await MerchantsPage());
    expect(screen.getByText(/no merchant profiles/i)).toBeInTheDocument();
    merchants.unmount();
    render(await ReviewPage());
    expect(screen.getByText(/no cases currently require human review/i)).toBeInTheDocument();
  });

  it('propagates backend errors to the route error boundary instead of rendering partial data', async () => {
    setDataProvider(live({ listCases: async () => { throw new DataSourceError('down'); } }));
    await expect(CasesPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(DataSourceError);
  });

  it('error and loading states render accessibly; retry calls reset', () => {
    const reset = vi.fn();
    render(<ErrorState error={new Error('x')} reset={reset} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/backend data unavailable/i);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(reset).toHaveBeenCalledOnce();
    render(<Loading />);
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });
});

describe('browser bundle safety', () => {
  it('no client component or shared UI file imports AWS code or reads credentials', () => {
    const root = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (['node_modules', '.next', 'tests', 'data'].includes(name)) continue;
        if (statSync(full).isDirectory()) walk(full); else if (/\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const clientFiles = files.filter((f) => /^['"]use client['"]/.test(readFileSync(f, 'utf8')));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const f of clientFiles) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/aws-sdk|lib\/data\/aws|AWS_(ACCESS|SECRET)|process\.env/);
    }
    // Nothing may publish AWS settings to the browser.
    expect(files.map((f) => readFileSync(f, 'utf8')).join('\n')).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(AWS|TABLE|BUCKET|SECRET)/);
  });
});
