const fs = require('fs');
const path = require('path');

// Read units directory
const unitsDir = path.join(__dirname, 'data', 'units');
const xpFile = path.join(__dirname, 'data', 'xp.json');

// Initialize detailed XP tracking
const xpData = {
  subjects: {},
  summary: {
    totalSubjects: 0,
    totalUnits: 0,
    totalXP: 0,
    completedUnits: 0,
    earnedXP: 0,
    overallProgress: 0
  }
};

// Get all unit files
const unitFiles = fs.readdirSync(unitsDir).filter(file => file.endsWith('.json'));

console.log('Processing unit files for detailed XP tracking...');

let totalUnits = 0;
let totalXP = 0;

unitFiles.forEach(file => {
  const filePath = path.join(unitsDir, file);
  const unitData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const subjectName = path.basename(file, '.json');
  
  console.log(`Processing ${subjectName}...`);
  
  const subjectData = {
    meta: unitData.meta || {},
    units: {},
    totalUnits: 0,
    totalXP: 0,
    completedUnits: 0,
    earnedXP: 0,
    progress: 0
  };
  
  let unitCounter = 0;
  
  // Function to extract units from tree structure
  function extractUnits(treeNodes, btIndex = null, clIndex = null) {
    treeNodes.forEach((node, nodeIndex) => {
      const currentBt = btIndex !== null ? btIndex : node.bt;
      
      if (node.units) {
        node.units.forEach((unit, unitIndex) => {
          const unitId = `${subjectName}_unit_${++unitCounter}`;
          subjectData.units[unitId] = {
            id: unitId,
            name: unit.n,
            description: unit.nt || '',
            tags: unit.t || [],
            links: unit.l || [],
            xp: 10,
            completed: false,
            completedAt: null,
            btIndex: currentBt,
            clIndex: clIndex,
            position: {
              nodeIndex,
              unitIndex
            }
          };
          subjectData.totalUnits++;
          subjectData.totalXP += 10;
        });
      }
      
      if (node.clusters) {
        node.clusters.forEach((cluster, clusterIndex) => {
          if (cluster.units) {
            cluster.units.forEach((unit, unitIndex) => {
              const unitId = `${subjectName}_unit_${++unitCounter}`;
              subjectData.units[unitId] = {
                id: unitId,
                name: unit.n,
                description: unit.nt || '',
                tags: unit.t || [],
                links: unit.l || [],
                xp: 10,
                completed: false,
                completedAt: null,
                btIndex: currentBt,
                clIndex: cluster.cl,
                position: {
                  nodeIndex,
                  clusterIndex,
                  unitIndex
                }
              };
              subjectData.totalUnits++;
              subjectData.totalXP += 10;
            });
          }
        });
      }
      
      if (node.children) {
        extractUnits(node.children, currentBt, clIndex);
      }
    });
  }
  
  if (unitData.tree) {
    extractUnits(unitData.tree);
  }
  
  xpData.subjects[subjectName] = subjectData;
  
  totalUnits += subjectData.totalUnits;
  totalXP += subjectData.totalXP;
  
  console.log(`  ${subjectData.totalUnits} individual units tracked, ${subjectData.totalXP} XP`);
});

// Update summary
xpData.summary.totalSubjects = unitFiles.length;
xpData.summary.totalUnits = totalUnits;
xpData.summary.totalXP = totalXP;

console.log('\nSummary:');
console.log(`Total subjects: ${unitFiles.length}`);
console.log(`Total individual units: ${totalUnits}`);
console.log(`Total XP available: ${totalXP}`);

// Write updated detailed XP data
fs.writeFileSync(xpFile, JSON.stringify(xpData, null, 2));
console.log(`\nDetailed XP data updated: ${xpFile}`);
