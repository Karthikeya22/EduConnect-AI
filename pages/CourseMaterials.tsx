
import React from 'react';
import AssetHub from './UploadMaterials';
import { AppPath } from '../App';

interface CourseMaterialsProps {
  onBack: () => void;
  onLogout: () => void;
  onNavigateTo: (path: AppPath) => void;
  currentPath: AppPath;
  user?: any;
}

const CourseMaterials: React.FC<CourseMaterialsProps> = (props) => {
  return <AssetHub {...props} role="student" />;
};

export default CourseMaterials;
