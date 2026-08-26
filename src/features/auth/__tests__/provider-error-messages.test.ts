import {
  describeGoogleLoginError,
  describeIdentityLinkError,
  describeOtpRequestError,
  describeOtpVerifyError,
  describeUnlinkError,
} from '@/features/auth/provider-error-messages';
import { ApiError } from '@/services/api/client';

describe('describeGoogleLoginError', () => {
  it('points AUTH_ACCOUNT_LINK_REQUIRED at the account-linking recovery path', () => {
    // The collision boundary is correct and must not be relitigated. The
    // message has to name the ONE supported way forward, and the control it
    // names exists on the Account Security screen.
    expect(
      describeGoogleLoginError(new ApiError(409, 'AUTH_ACCOUNT_LINK_REQUIRED', 'Collides.'))
    ).toBe('login.googleLinkRequired');
  });

  it('separates a rejected token, a disabled provider and a generic failure', () => {
    expect(describeGoogleLoginError(new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'No.'))).toBe(
      'login.googleRejected'
    );
    expect(describeGoogleLoginError(new ApiError(503, 'GOOGLE_AUTH_DISABLED', 'Off.'))).toBe(
      'login.googleDisabled'
    );
    expect(describeGoogleLoginError(new ApiError(0, 'NETWORK_ERROR', 'Offline.'))).toBe(
      'login.googleFailed'
    );
  });

  it('does not collapse the collision into the generic failure', () => {
    const collision = describeGoogleLoginError(
      new ApiError(409, 'AUTH_ACCOUNT_LINK_REQUIRED', 'Collides.')
    );

    expect(collision).not.toBe('login.googleFailed');
  });

  it('handles a non-ApiError without throwing', () => {
    expect(describeGoogleLoginError(new Error('boom'))).toBe('login.googleFailed');
    expect(describeGoogleLoginError(undefined)).toBe('login.googleFailed');
  });
});

describe('describeOtpRequestError', () => {
  it('gives WHATSAPP_PROVIDER_UNAVAILABLE its own message, because the advice differs', () => {
    // Delivery definitively failed for a reason that has nothing to do with
    // WHICH number was targeted - a transport error, an expired token, a
    // paused template. No challenge survives it, so no cooldown was spent and
    // no slot was taken from the number's hourly budget: "try again" is true
    // and immediate here, where for a 429 it would be a lie.
    expect(
      describeOtpRequestError(new ApiError(503, 'WHATSAPP_PROVIDER_UNAVAILABLE', 'Down.'))
    ).toBe('whatsapp.providerUnavailable');
  });

  it('keeps the provider outage distinct from the provider being switched off', () => {
    // `WHATSAPP_AUTH_DISABLED` is a deployment that has no WhatsApp
    // configuration at all - retrying cannot help. The two must not collapse.
    expect(describeOtpRequestError(new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'Off.'))).toBe(
      'whatsapp.disabled'
    );
    expect(
      describeOtpRequestError(new ApiError(503, 'WHATSAPP_PROVIDER_UNAVAILABLE', 'Down.'))
    ).not.toBe('whatsapp.disabled');
  });

  it('treats BOTH 429 limiters the same, by status rather than code', () => {
    // The per-IP route throttle is applied by the framework and carries the
    // generic `HTTP_ERROR` code, so status is the only reliable signal.
    expect(describeOtpRequestError(new ApiError(429, 'HTTP_ERROR', 'Slow.'))).toBe(
      'whatsapp.tooManyRequests'
    );
    expect(describeOtpRequestError(new ApiError(429, 'OTP_RESEND_COOLDOWN', 'Wait.'))).toBe(
      'whatsapp.tooManyRequests'
    );
  });

  it('separates an invalid number and a disabled provider', () => {
    expect(describeOtpRequestError(new ApiError(400, 'INVALID_PHONE_NUMBER', 'Bad.'))).toBe(
      'whatsapp.phoneInvalid'
    );
    expect(describeOtpRequestError(new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'Off.'))).toBe(
      'whatsapp.disabled'
    );
  });
});

describe('describeOtpVerifyError', () => {
  it('gives INVALID_OTP one message, whatever the real cause was', () => {
    // Wrong / expired / attempts-exhausted / already-used / no-challenge
    // all arrive as this one code, on purpose: splitting it would report
    // guessing progress and would make the endpoint a phone-number
    // enumeration oracle.
    expect(describeOtpVerifyError(new ApiError(401, 'INVALID_OTP', 'No.'))).toBe(
      'whatsapp.otpRejected'
    );
  });

  it('keeps the per-IP verify throttle distinct from a rejected code', () => {
    // Not dead code, and not the resend cooldown: that one is a 429 on the
    // START route. Waiting is the only thing that helps here.
    expect(describeOtpVerifyError(new ApiError(429, 'HTTP_ERROR', 'Slow.'))).toBe(
      'whatsapp.verifyTooMany'
    );
    expect(describeOtpVerifyError(new ApiError(429, 'HTTP_ERROR', 'Slow.'))).not.toBe(
      'whatsapp.otpRejected'
    );
  });

  it('never produces a message for a state the backend refuses to reveal', () => {
    // No mapping exists for the provisional three-way split. If one is ever
    // added, this fails.
    expect(describeOtpVerifyError(new ApiError(410, 'OTP_EXPIRED', 'Gone.'))).toBe(
      'whatsapp.verifyFailed'
    );
    expect(describeOtpVerifyError(new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Many.'))).toBe(
      // Reaches the 429 branch by STATUS, not by that provisional code.
      'whatsapp.verifyTooMany'
    );
  });
});

describe('describeIdentityLinkError', () => {
  it('distinguishes "belongs to another account" from "you already have one"', () => {
    // Two different facts with two different resolutions. Collapsing them
    // would turn an actionable refusal into a dead end.
    const ownedElsewhere = describeIdentityLinkError(
      new ApiError(409, 'AUTH_IDENTITY_ALREADY_LINKED', 'Owned.'),
      'google'
    );
    const alreadyHaveOne = describeIdentityLinkError(
      new ApiError(409, 'AUTH_PROVIDER_ALREADY_LINKED', 'Have one.'),
      'google'
    );

    expect(ownedElsewhere).toBe('authMethods.identityOwnedByAnotherAccount');
    expect(alreadyHaveOne).toBe('authMethods.providerAlreadyLinked');
    expect(ownedElsewhere).not.toBe(alreadyHaveOne);
  });

  it('reuses the generic OTP message on the WhatsApp link route', () => {
    // The link route consumes the same challenge and answers the same
    // deliberately generic code.
    expect(
      describeIdentityLinkError(new ApiError(401, 'INVALID_OTP', 'No.'), 'whatsapp')
    ).toBe('whatsapp.otpRejected');
  });

  it('reports a disabled provider on either link route', () => {
    expect(
      describeIdentityLinkError(new ApiError(503, 'GOOGLE_AUTH_DISABLED', 'Off.'), 'google')
    ).toBe('login.googleDisabled');
    expect(
      describeIdentityLinkError(new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'Off.'), 'whatsapp')
    ).toBe('whatsapp.disabled');
  });

  it('falls back to a link-specific failure, never to a login message', () => {
    expect(describeIdentityLinkError(new ApiError(0, 'NETWORK_ERROR', 'Offline.'), 'google')).toBe(
      'authMethods.linkFailed'
    );
  });
});

describe('describeUnlinkError', () => {
  it('reports AUTH_LAST_IDENTITY as the truthful last-method refusal', () => {
    // Reachable despite the hidden control, because a client's list can be
    // one action out of date. It must never imply a retry would work.
    expect(describeUnlinkError(new ApiError(409, 'AUTH_LAST_IDENTITY', 'Refused.'))).toBe(
      'authMethods.lastMethod'
    );
  });

  it('separates a missing identity from a generic failure', () => {
    expect(describeUnlinkError(new ApiError(404, 'AUTH_IDENTITY_NOT_FOUND', 'Gone.'))).toBe(
      'authMethods.identityNotFound'
    );
    expect(describeUnlinkError(new ApiError(0, 'NETWORK_ERROR', 'Offline.'))).toBe(
      'authMethods.unlinkFailed'
    );
  });

  it('has no mapping for the provisional LAST_AUTH_METHOD name', () => {
    expect(describeUnlinkError(new ApiError(409, 'LAST_AUTH_METHOD', 'Refused.'))).toBe(
      'authMethods.unlinkFailed'
    );
  });
});
