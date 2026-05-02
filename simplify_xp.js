const fs = require('fs');
const path = require('path');

// Read units directory and create simplified XP mapping
const unitsDir = path.join(__dirname, 'data', 'units');
const xpDir = path.join(__dirname, 'data', 'xp');

// Get all unit files
const unitFiles = fs.readdirSync(unitsDir).filter(file => file.endsWith('.json'));

console.log('Creating simplified XP mapping files...');

unitFiles.forEach(file => {
  const filePath = path.join(unitsDir, file);
  const unitData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const subjectName = path.basename(file, '.json');
  
  console.log(`Processing ${subjectName}...`);
  
  // Create simplified XP data structure
  const xpData = {
    xp: {
      cumulativeXP: 0,
      currentBand: 0,
      totalUnits: 0,
      completedUnits: 0,
      totalXP: 0
    },
    tree: []
  };
  
  let unitCounter = 0;
  let cumulativeXP = 0;
  
  // Function to process tree nodes and create minimal XP tracking
  function processTreeNodes(originalNodes) {
    return originalNodes.map(node => {
      const processedNode = { bt: node.bt };
      
      if (node.units) {
        processedNode.units = node.units.map(unit => {
          unitCounter++;
          cumulativeXP += 10;
          
          return {
            n: unit.n,
            xp: 10,
            completed: false,
            cumulativeXP: cumulativeXP
          };
        });
      }
      
      if (node.clusters) {
        processedNode.clusters = node.clusters.map(cluster => {
          const processedCluster = { cl: cluster.cl };
          
          if (cluster.units) {
            processedCluster.units = cluster.units.map(unit => {
              unitCounter++;
              cumulativeXP += 10;
              
              return {
                n: unit.n,
                xp: 10,
                completed: false,
                cumulativeXP: cumulativeXP
              };
            });
          }
          
          return processedCluster;
        });
      }
      
      if (node.children) {
        processedNode.children = processTreeNodes(node.children);
      }
      
      return processedNode;
    });
  }
  
  // Process the tree
  if (unitData.tree) {
    xpData.tree = processTreeNodes(unitData.tree);
  }
  
  // Update XP summary
  xpData.xp.totalUnits = unitCounter;
  xpData.xp.totalXP = cumulativeXP;
  xpData.xp.cumulativeXP = cumulativeXP;
  
  // Determine current band based on completed units (for now 0)
  const bandSize = Math.ceil(xpData.xp.totalXP / 7); // Divide into 7 bands
  xpData.xp.currentBand = Math.floor(xpData.xp.completedUnits / Math.ceil(xpData.xp.totalUnits / 7));
  
  // Write simplified XP file
  const xpFilePath = path.join(xpDir, file);
  fs.writeFileSync(xpFilePath, JSON.stringify(xpData, null, 2));
  
  console.log(`  Created: ${xpFilePath}`);
  console.log(`  Total units: ${unitCounter}, Total XP: ${cumulativeXP}`);
});

console.log('\nSimplified XP mapping files created in data/xp/');
