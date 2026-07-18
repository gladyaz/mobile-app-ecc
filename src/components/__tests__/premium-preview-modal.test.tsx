import { render, fireEvent } from '@testing-library/react-native';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';

describe('PremiumPreviewModal', () => {
  it('shows the premium message when visible', async () => {
    const { getByText } = await render(
      <PremiumPreviewModal onDismiss={jest.fn()} visible />
    );

    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('calls onDismiss when "Segera Hadir" is pressed', async () => {
    const onDismiss = jest.fn();
    const { getByText } = await render(<PremiumPreviewModal onDismiss={onDismiss} visible />);

    fireEvent.press(getByText('Segera Hadir'));

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

  it('does not render the secondary action when onGoToFreeEpisode is not provided', async () => {
    const { queryByText } = await render(<PremiumPreviewModal onDismiss={jest.fn()} visible />);

    expect(queryByText('Kembali ke Episode Gratis')).toBeNull();
  });
});
