import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '../api/client';
import Onboarding from './Onboarding';

/** Edit the saved farm with the same wizard, pre-filled (starts at the sub-zones step). */
export default function EditFarm() {
  const farms = useQuery({ queryKey: ['my-farms'], queryFn: api.myFarms });
  const farm = farms.data?.[farms.data.length - 1];
  if (!farm) return <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  return <Onboarding key={farm.farm_id + farm.created_at} editFarm={farm} />;
}
