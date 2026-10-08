import type { Metadata } from 'next';
import SoloTable from './SoloTable';

export const metadata: Metadata = {
  title: 'Solo vs CPU — SA Dominoes',
  description: 'Play South African dominoes solo against three CPU players. No room code needed.',
};

export default function SoloPage() {
  return <SoloTable />;
}
