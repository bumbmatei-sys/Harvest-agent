import fs from 'fs';
import path from 'path';

function removeDarkClasses(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      removeDarkClasses(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts') || fullPath.endsWith('.css')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Remove dark: classes
      const newContent = content.replace(/dark:[a-zA-Z0-9\-\[\]\#\/\%]+/g, '').replace(/\s+/g, ' ');
      
      // Actually, a safer regex for dark classes:
      // We don't want to mess up the file completely by replacing all whitespace with single spaces.
      
      let safeContent = content.replace(/dark:[a-zA-Z0-9\-\[\]\#\/\%]+/g, '');
      // Clean up multiple spaces left behind
      safeContent = safeContent.replace(/ {2,}/g, ' ');
      
      if (content !== safeContent) {
        fs.writeFileSync(fullPath, safeContent, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

removeDarkClasses('./src');
