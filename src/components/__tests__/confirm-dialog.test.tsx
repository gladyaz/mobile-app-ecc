import { render, fireEvent } from '@testing-library/react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';

describe('ConfirmDialog', () => {
  it('renders the title and message when visible', async () => {
    const { getByText } = await render(
      <ConfirmDialog
        message="This cannot be undone."
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        title="Are you sure?"
        visible
      />
    );

    expect(getByText('Are you sure?')).toBeTruthy();
    expect(getByText('This cannot be undone.')).toBeTruthy();
  });

  it('calls onCancel when the cancel button is pressed', async () => {
    const onCancel = jest.fn();
    const { getByText } = await render(
      <ConfirmDialog
        message="msg"
        onCancel={onCancel}
        onConfirm={jest.fn()}
        title="title"
        visible
      />
    );

    fireEvent.press(getByText('Batal'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = jest.fn();
    const { getByText } = await render(
      <ConfirmDialog
        confirmLabel="Delete it"
        message="msg"
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        title="title"
        visible
      />
    );

    fireEvent.press(getByText('Delete it'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the confirm label while isConfirming is true', async () => {
    const { queryByText } = await render(
      <ConfirmDialog
        confirmLabel="Delete it"
        isConfirming
        message="msg"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        title="title"
        visible
      />
    );

    expect(queryByText('Delete it')).toBeNull();
  });

  it('does not call onConfirm when disabled by isConfirming', async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <ConfirmDialog
        isConfirming
        message="msg"
        onCancel={jest.fn()}
        onConfirm={onConfirm}
        title="title"
        visible
      />
    );

    fireEvent.press(getByTestId('confirm-dialog-confirm'));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
