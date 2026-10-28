import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookOpen } from 'lucide-react';

import { ProductWizard, NewProductDialog, type WizardStep, type ProductTypeOption } from '@/components/product-wizard';
import { all, byName, click, mount, need, text, unmount } from '@/components/email/__tests__/dom';

afterEach(unmount);

const STEPS: WizardStep[] = [
  { id: 'offer', label: 'Offer', done: true },
  { id: 'lessons', label: 'Lessons' },
  { id: 'page', label: 'Page' },
  { id: 'publish', label: 'Publish' },
];

function Harness(props: { onSave?: () => void; onPublish?: () => void; blocked?: string | null; start?: string; title?: string }) {
  const [step, setStep] = useState(props.start ?? 'offer');
  return (
    <ProductWizard
      productLabel="Course"
      title={props.title ?? ''}
      untitledLabel="Untitled course"
      status="draft"
      ownerLabel="Grace Ministry"
      steps={STEPS}
      activeStepId={step}
      onStepChange={setStep}
      onSaveDraft={props.onSave ?? (() => {})}
      onPublish={props.onPublish ?? (() => {})}
      publishBlockedReason={props.blocked}
      preview={<p>preview pane</p>}
    >
      <p data-body>{`body of ${step}`}</p>
    </ProductWizard>
  );
}

describe('ProductWizard shell', () => {
  it('shows the untitled name, the draft badge and the owner line', async () => {
    await mount(<Harness />);
    expect(need(document.querySelector<HTMLElement>('[data-wizard-title]'), 'title').textContent).toBe('Untitled course');
    expect(need(document.querySelector<HTMLElement>('[data-wizard-status]'), 'badge').textContent).toBe('Draft');
    expect(text()).toContain('Course · Grace Ministry');
  });

  it('draws every step in the rail, marks the active one, and reports progress', async () => {
    await mount(<Harness />);
    const rail = all('[data-step]');
    expect(rail.map((b) => b.getAttribute('data-step'))).toEqual(['offer', 'lessons', 'page', 'publish']);
    expect(rail[0].getAttribute('aria-current')).toBe('step');
    expect(rail[1].getAttribute('aria-current')).toBeNull();
    expect(text()).toContain('1 of 4 steps done');
  });

  it('constrains the mobile grid and scrolls the step rail within it', async () => {
    await mount(<Harness />);
    const nav = need(document.querySelector<HTMLElement>('nav[aria-label="Course steps"]'), 'nav');
    expect(nav.className.split(/\s+/)).toContain('min-w-0');
    expect(nav.querySelector('ol')?.className.split(/\s+/)).toContain('overflow-x-auto');
    expect(nav.parentElement?.className.split(/\s+/)).toContain('grid-cols-[minmax(0,1fr)]');
  });

  it('moves between steps from the rail, and Continue walks forward then offers Publish on the last', async () => {
    const onPublish = vi.fn();
    await mount(<Harness onPublish={onPublish} />);
    await click(need(document.querySelector<HTMLElement>('[data-step="page"]'), 'page'));
    expect(need(document.querySelector<HTMLElement>('[data-body]'), 'body').textContent).toBe('body of page');
    await click(need(document.querySelector<HTMLElement>('[data-wizard-primary="next"]'), 'continue'));
    expect(document.querySelector<HTMLElement>('[data-body]')?.textContent).toBe('body of publish');
    expect(document.querySelector<HTMLElement>('[data-wizard-primary="next"]')).toBeNull();
    await click(need(document.querySelector<HTMLElement>('[data-wizard-primary="publish"]'), 'publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('Back in the footer steps back and is absent on the first step', async () => {
    await mount(<Harness start="lessons" />);
    await click(need(byName('[data-wizard-footer] button', 'Back'), 'back'));
    expect(document.querySelector<HTMLElement>('[data-body]')?.textContent).toBe('body of offer');
    expect(byName('[data-wizard-footer] button', 'Back')).toBeNull();
  });

  it('pins the save bar flush to the bottom of the admin scroller, which keeps lg:pb-8 below its content', async () => {
    await mount(<Harness start="offer" />);
    const footer = need(document.querySelector<HTMLElement>('[data-wizard-footer]'), 'footer');
    const classes = footer.className.split(/\s+/);
    expect(classes).toContain('sticky');
    expect(classes).toContain('bottom-0');
    expect(classes).toContain('lg:-bottom-8');
  });

  it('disables Publish and says why while the product is not ready, but still saves a draft', async () => {
    const onSave = vi.fn();
    await mount(<Harness start="publish" blocked="Add a lesson first." onSave={onSave} />);
    expect(need(document.querySelector<HTMLElement>('[data-wizard-primary="publish"]'), 'publish').hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Add a lesson first.');
    await click(need(byName('button', 'Save draft'), 'save'));
    expect(onSave).toHaveBeenCalled();
  });

  it('renders the live preview in its own labelled region', async () => {
    await mount(<Harness />);
    expect(need(document.querySelector<HTMLElement>('aside[aria-label="Live preview"]'), 'preview').textContent).toContain('preview pane');
  });
});

const TYPES: ProductTypeOption[] = [
  { id: 'course', label: 'Course', description: 'Lessons people read or watch.', membersGet: 'Lessons and progress', icon: <BookOpen />, tag: 'Start here', available: true },
  { id: 'event', label: 'Event', description: 'A gathering with a date.', membersGet: 'A seat', icon: <BookOpen />, available: false },
];

describe('NewProductDialog', () => {
  it('lists available types as choices and the rest as coming soon and disabled', async () => {
    const onSelect = vi.fn();
    await mount(<NewProductDialog open onOpenChange={() => {}} types={TYPES} onSelect={onSelect} />);
    const course = need(document.querySelector<HTMLElement>('[data-product-type="course"]'), 'course');
    const event = need(document.querySelector<HTMLElement>('[data-product-type="event"]'), 'event');
    expect(course.hasAttribute('disabled')).toBe(false);
    expect(event.hasAttribute('disabled')).toBe(true);
    expect(event.textContent).toContain('Coming soon');
    expect(course.textContent).toContain('Members get: Lessons and progress');
    await click(course);
    expect(onSelect).toHaveBeenCalledWith('course');
  });
});
