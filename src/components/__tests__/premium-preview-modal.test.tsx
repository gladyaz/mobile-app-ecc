import { render, fireEvent } from '@testing-library/react-native';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';

describe('PremiumPreviewModal', () => {
  it('shows the premium message when visible', async () => {
    const { getByText } = await render(
      <PremiumPreviewModal onDismiss={jest.fn()} visible />
    );

    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('offers no "coming soon" promise - this build has no purchase flow to wait for', async () => {
    // The removed control was labelled "Segera Hadir" and wired to onDismiss:
    // a dead end that advertised a payment direction that is not shipping.
    // Asserted by absence so it cannot quietly return.
    const { queryByText } = await render(
      <PremiumPreviewModal onDismiss={jest.fn()} onGoToFreeEpisode={jest.fn()} visible />
    );

    expect(queryByText('Segera Hadir')).toBeNull();
  });

  it('always renders a close control, so the dialog is never a trap', async () => {
    // The no-free-episode case is the one that matters: without this the card
    // would have no visible way out, leaving only the Android back gesture.
    const onDismiss = jest.fn();
    const { getByText } = await render(<PremiumPreviewModal onDismiss={onDismiss} visible />);

    fireEvent.press(getByText('Tutup'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onGoToFreeEpisode when "Kembali ke Episode Gratis" is pressed', async () => {
    const onGoToFreeEpisode = jest.fn();
    const { getByText } = await render(
      <PremiumPreviewModal onDismiss={jest.fn()} onGoToFreeEpisode={onGoToFreeEpisode} visible />
    );

    fireEvent.press(getByText('Kembali ke Episode Gratis'));

    expect(onGoToFreeEpisode).toHaveBeenCalledTimes(1);
  });

  it('does not render the free-episode action when onGoToFreeEpisode is not provided', async () => {
    const { queryByText } = await render(<PremiumPreviewModal onDismiss={jest.fn()} visible />);

    expect(queryByText('Kembali ke Episode Gratis')).toBeNull();
  });
});
