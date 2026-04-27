import React from 'react';
import { formatVerificationTime } from '../utils/keyVerification';

const VerificationModal = ({ 
  isOpen, 
  onClose, 
  verificationInfo, 
  onVerify, 
  onCancel,
  username
}) => {
  if (!isOpen) return null;

  const { 
    status, 
    message, 
    contactUsername, 
    fingerprint, 
    previousFingerprint,
    verifiedAt
  } = verificationInfo;

  const isWarning = status === 'key_mismatch' || status === 'device_changed';
  const isNewContact = status === 'new_contact';

  const warningColor = '#ef4444';
  const infoColor = '#3b82f6';
  const successColor = '#22c55e';

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'var(--bg-primary)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        width: '90%',
        maxWidth: 500,
        padding: 24,
        border: isWarning ? `1px solid ${warningColor}` : '1px solid var(--border-color)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16
        }}>
          <h2 style={{
            color: isWarning ? warningColor : (isNewContact ? infoColor : successColor),
            margin: 0,
            fontSize: 18
          }}>
            {isWarning ? '⚠️ Identity Verification Warning' : 
              (isNewContact ? 'New Contact Verification' : 'Identity Verified')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 20,
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          padding: 16,
          borderRadius: 4,
          marginBottom: 20,
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>
              CONTACT
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 'bold' }}>
              {contactUsername}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>
              CURRENT KEY FINGERPRINT
            </div>
            <div style={{ 
              color: infoColor, 
              fontSize: 12,
              fontFamily: 'monospace',
              wordBreak: 'break-all'
            }}>
              {fingerprint || 'N/A'}
            </div>
          </div>

          {previousFingerprint && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>
                PREVIOUS KEY FINGERPRINT
              </div>
              <div style={{ 
                color: warningColor, 
                fontSize: 12,
                fontFamily: 'monospace',
                wordBreak: 'break-all'
              }}>
                {previousFingerprint}
              </div>
            </div>
          )}

          {message && (
            <div style={{ 
              marginTop: 12, 
              padding: 12, 
              backgroundColor: isWarning ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              borderRadius: 4,
              border: `1px solid ${isWarning ? warningColor : infoColor}`
            }}>
              <div style={{ color: isWarning ? warningColor : infoColor, fontSize: 13 }}>
                {message}
              </div>
            </div>
          )}

          {verifiedAt && (
            <div style={{ 
              marginTop: 12, 
              color: 'var(--text-muted)', 
              fontSize: 12 
            }}>
              Verified: {formatVerificationTime(verifiedAt)}
            </div>
          )}
        </div>

        {isNewContact && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12
          }}>
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontSize: 14,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={onVerify}
              style={{
                padding: '10px 20px',
                backgroundColor: infoColor,
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 14,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Verify & Trust Key
            </button>
          </div>
        )}

        {isWarning && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12
          }}>
            <button
              onClick={onCancel}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontSize: 14,
                cursor: 'pointer'
              }}
            >
              Ignore Warning
            </button>
            <button
              onClick={onVerify}
              style={{
                padding: '10px 20px',
                backgroundColor: warningColor,
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 14,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Confirm New Key
            </button>
          </div>
        )}

        {!isNewContact && !isWarning && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end'
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--accent-primary)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 14,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VerificationModal;