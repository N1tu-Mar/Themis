import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CasesPage from '@/app/cases/page';
import CaseDetailPage from '@/app/cases/[caseId]/page';
import MerchantsPage from '@/app/merchants/page';
import MerchantDetailPage from '@/app/merchants/[merchantId]/page';
import ReviewPage from '@/app/review/page';
import { EmptyState } from '@/components/ui';

describe('case list page', () => {
  it('renders shared Case data as rows', async () => {
    const el = await CasesPage({ searchParams: Promise.resolve({}) });
    render(el);
    expect(screen.getByText('case_demo_a')).toBeInTheDocument();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    const el = await CasesPage({ searchParams: Promise.resolve({ status: 'NEW', review: '1' }) });
    render(el);
    expect(screen.getByText(/no cases match/i)).toBeInTheDocument();
  });
});

describe('case detail page', () => {
  it('renders evidence and policy decisions for a known case', async () => {
    const el = await CaseDetailPage({ params: Promise.resolve({ caseId: 'case_demo_d' }) });
    render(el);
    expect(screen.getByText('case_demo_d')).toBeInTheDocument();
    expect(screen.getByText('Structured evidence')).toBeInTheDocument();
    expect(screen.getByText('Policy decisions')).toBeInTheDocument();
  });
});

describe('merchant pages', () => {
  it('renders merchant aliases on the list page', async () => {
    const el = await MerchantsPage();
    render(el);
    expect(screen.getByText('Asteria Digital')).toBeInTheDocument();
  });

  it('renders full aliases and risk signals on the detail page', async () => {
    const el = await MerchantDetailPage({ params: Promise.resolve({ merchantId: 'merchant_demo_001' }) });
    render(el);
    expect(screen.getByText('ASTERIA.IO')).toBeInTheDocument();
    expect(screen.getByText('Current risk signals')).toBeInTheDocument();
  });
});

describe('review queue page', () => {
  it('shows the escalated case with its agent proposal', async () => {
    const el = await ReviewPage();
    render(el);
    expect(screen.getByText('case_demo_d')).toBeInTheDocument();
    expect(screen.getByText('Agent proposal')).toBeInTheDocument();
  });

  it('keeps review actions explicitly read-only', async () => {
    render(await ReviewPage());
    const buttons = screen.getAllByRole('button', { name: /proposed action|more evidence/i });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });
});

describe('empty state', () => {
  it('renders a message', () => {
    render(<EmptyState label="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});
