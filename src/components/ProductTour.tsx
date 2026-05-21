import React, { useState, useEffect, useRef } from 'react';

interface Step {
  targetId: string;
  title: string;
  description: string;
}

const TOUR_STEPS: Step[] = [
  {
    targetId: 'tour-dashboard',
    title: 'Executive Control Plane',
    description: 'Your security control plane — posture score, threats, and scan metrics at a glance.'
  },
  {
    targetId: 'tour-repos',
    title: 'Code Repositories',
    description: 'Connect your GitHub, GitLab, or Bitbucket repos to start scanning.'
  },
  {
    targetId: 'tour-tasks',
    title: 'Remediation Center',
    description: 'All findings from your scans land here — triage, assign, and track remediation.'
  },
  {
    targetId: 'tour-alerts',
    title: 'Real-Time Alert Mesh',
    description: 'Wire up Slack, Discord, or PagerDuty to get notified the moment threats are detected.'
  },
  {
    targetId: 'tour-release',
    title: 'Automated Release Gates',
    description: 'Set pass/fail policies that block deployments when security thresholds are breached.'
  },
  {
    targetId: 'tour-settings',
    title: 'System Settings',
    description: 'Configure your workspace, team, and platform preferences here.'
  }
];

export default function ProductTour() {
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; placement: 'right' | 'bottom' }>({ top: 0, left: 0, placement: 'right' });
  const [isVisible, setIsVisible] = useState(false);
  
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);

  // Initialize and check onboarding status
  useEffect(() => {
    const isCompleted = localStorage.getItem('scorpion_onboarded') === 'true';
    if (!isCompleted) {
      const timer = setTimeout(() => {
        setCurrentStep(0);
        setIsVisible(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Helper to remove green highlight styles from the previous active element
  const removeTargetHighlight = () => {
    if (activeElementRef.current) {
      activeElementRef.current.style.outline = '';
      activeElementRef.current.style.boxShadow = '';
      activeElementRef.current.style.borderRadius = '';
      activeElementRef.current = null;
    }
  };

  // Helper to apply green glow ring styles directly to the active element
  const applyTargetHighlight = (element: HTMLElement) => {
    removeTargetHighlight();
    element.style.outline = '2px solid #6db87a';
    element.style.boxShadow = '0 0 0 4px rgba(109, 184, 122, 0.3)';
    element.style.borderRadius = '8px';
    element.style.transition = 'all 0.2s ease-in-out';
    activeElementRef.current = element;
  };

  // Recalculate target position and update tooltip position dynamically
  useEffect(() => {
    if (currentStep < 0 || currentStep >= TOUR_STEPS.length || !isVisible) {
      removeTargetHighlight();
      setCoords(null);
      return;
    }

    const step = TOUR_STEPS[currentStep];

    const updatePosition = () => {
      const target = document.getElementById(step.targetId);
      if (target) {
        const rect = target.getBoundingClientRect();
        
        // Ensure element has actual visible coordinates in the viewport
        if (rect.width > 0 && rect.height > 0) {
          setCoords({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          });

          // Apply highlight style directly
          applyTargetHighlight(target);

          // Get dimensions dynamically, fallback if not fully rendered
          const tooltipWidth = tooltipRef.current?.offsetWidth || 320;
          const tooltipHeight = tooltipRef.current?.offsetHeight || 150;
          
          const isDesktop = window.innerWidth >= 768;

          if (isDesktop) {
            // Position to the right of sidebar item
            const leftPos = rect.right + 16;
            const topPos = rect.top + (rect.height / 2) - (tooltipHeight / 2);
            setTooltipPos({
              top: Math.max(16, Math.min(topPos, window.innerHeight - tooltipHeight - 16)),
              left: leftPos,
              placement: 'right'
            });
          } else {
            // Position underneath sidebar item on mobile
            const leftPos = rect.left + (rect.width / 2) - (tooltipWidth / 2);
            const topPos = rect.bottom + 16;
            setTooltipPos({
              top: topPos,
              left: Math.max(16, Math.min(leftPos, window.innerWidth - tooltipWidth - 16)),
              placement: 'bottom'
            });
          }
        }
      }
    };

    // Single fast 50ms setTimeout to let DOM paint, then position once
    const timerId = setTimeout(() => {
      updatePosition();
    }, 50);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      clearTimeout(timerId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [currentStep, isVisible]);

  // Clean up styles on unmount
  useEffect(() => {
    return () => {
      removeTargetHighlight();
    };
  }, []);

  if (currentStep < 0 || currentStep >= TOUR_STEPS.length || !isVisible) {
    return null;
  }

  const step = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      handleComplete();
    } else {
      setIsVisible(false);
      removeTargetHighlight();
      setTimeout(() => {
        setCurrentStep(prev => prev + 1);
        setIsVisible(true);
      }, 50); // Instant 50ms transition
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem('scorpion_onboarded', 'true');
    removeTargetHighlight();
    setIsVisible(false);
    setCurrentStep(-1);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none' }}>
      {/* Light Overlay Backdrop (remains interactive) */}
      <div 
        style={{ 
          position: 'fixed', 
          inset: 0, 
          background: 'rgba(0, 0, 0, 0.3)', 
          backdropFilter: 'blur(0.5px)',
          pointerEvents: 'none', // Allows clicking through overlay
          transition: 'opacity 0.2s ease',
          opacity: isVisible ? 1 : 0
        }}
      />

      {/* Light Clean Tour Tooltip Card */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: '320px',
          background: '#ffffff',
          border: '1px solid #e5e5e5',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          pointerEvents: 'auto', // Button interaction active
          zIndex: 100000,
          transition: 'opacity 0.15s ease, transform 0.15s ease',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.97) translateY(3px)'
        }}
      >
        {/* Step Indicator */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ color: '#6db87a', fontSize: '9px', fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            System Tour
          </span>
          <span style={{ color: '#666666', fontSize: '10px', fontWeight: 'bold', fontFamily: 'monospace' }}>
            {currentStep + 1} of {TOUR_STEPS.length}
          </span>
        </div>

        {/* Title & Description */}
        <h3 style={{ color: '#0a0a0a', fontSize: '14px', fontWeight: 'bold', marginBottom: '6px', letterSpacing: '-0.01em' }}>
          {step.title}
        </h3>
        <p style={{ color: '#444444', fontSize: '11px', lineHeight: '1.5', marginBottom: '20px' }}>
          {step.description}
        </p>

        {/* Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={handleSkip}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666666',
              fontSize: '10px',
              fontWeight: 'bold',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '6px 0',
              fontFamily: 'monospace',
              transition: 'color 0.2s ease'
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
            onMouseLeave={e => e.currentTarget.style.color = '#666666'}
          >
            Skip Tour
          </button>
          
          <button
            onClick={handleNext}
            style={{
              background: '#6db87a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 16px',
              fontSize: '10px',
              fontWeight: 'black',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'monospace',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 12px rgba(109, 184, 122, 0.3)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#84cb90';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#6db87a';
              e.currentTarget.style.transform = 'none';
            }}
          >
            {isLastStep ? 'Done ✓' : 'Next →'}
          </button>
        </div>

        {/* Arrow Pointing Left at Highlighted Item */}
        <div
          style={{
            position: 'absolute',
            width: '0',
            height: '0',
            borderStyle: 'solid',
            ...getArrowStyle(tooltipPos.placement)
          }}
        />
      </div>
    </div>
  );
}

// Styling for CSS arrows (white to match tooltip background)
function getArrowStyle(placement: 'right' | 'bottom') {
  if (placement === 'right') {
    return {
      left: '-6px',
      top: 'calc(50% - 6px)',
      borderWidth: '6px 6px 6px 0',
      borderColor: 'transparent #ffffff transparent transparent'
    };
  } else {
    return {
      left: 'calc(50% - 6px)',
      top: '-6px',
      borderWidth: '0 6px 6px 6px',
      borderColor: 'transparent transparent #ffffff transparent'
    };
  }
}
