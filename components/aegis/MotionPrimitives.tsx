'use client';

import React, { useEffect, useState } from 'react';
import { motion, useSpring } from 'motion/react';

export function AnimatedNumber({
  value,
  className = '',
}: {
  value: number;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 120, damping: 20, mass: 0.6 });
  const [display, setDisplay] = useState<number>(value);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsubscribe = spring.on('change', (latest) => {
      setDisplay(Math.round(latest));
    });
    return () => unsubscribe();
  }, [spring]);

  return <span className={`tabular-nums ${className}`}>{display.toLocaleString()}</span>;
}

export function RevealBlock({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function InteractiveSpotlightCard({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onMouseLeave={() => setPos(null)}
      className={`relative overflow-hidden transition-colors duration-200 ${className}`}
    >
      {pos && (
        <div
          className="pointer-events-none absolute -inset-px opacity-80 transition-opacity duration-200"
          style={{
            background: `radial-gradient(280px circle at ${pos.x}px ${pos.y}px, rgba(88, 101, 242, 0.14), transparent 70%)`,
          }}
          aria-hidden="true"
        />
      )}
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  );
}
