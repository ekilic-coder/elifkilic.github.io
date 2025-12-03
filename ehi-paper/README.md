# A Heat Index for Laboring Populations

This repository contains the manuscript and supporting materials for "A Heat Index for Laboring Populations" by Elif Kilic and Ashok Gadgil.

## Overview

This study modifies the Extended Heat Index (EHI) to incorporate:
- Variable metabolic heat production (3-6 METs, 174-348 W/m²)
- Physiological limits on sweating (2 L/h) and vasodilation (7.8 L/min)
- Smooth minimum function for monotonicity-preserving sweat capacity handling

## Repository Structure

```
ehi-paper/
├── manuscript.tex          # Main LaTeX manuscript
├── references.bib         # Bibliography
├── figures/               # Figures for the paper
├── supplementary/         # Supplementary materials
└── README.md             # This file
```

## Key Findings

- Increasing metabolic load shifts safe working thresholds to lower temperature-humidity combinations
- Physiological limits reduce heat tolerance by up to 33°C in certain conditions
- Region VI (physiological failure) occurs at 35-40°C for heavy work (5-6 METs) with high humidity
- Smooth minimum approach reduced monotonicity violations by 97.3% (1,799 → 48)

## Overleaf Integration

To connect this repository to Overleaf:
1. In Overleaf: Menu → GitHub → Link to GitHub
2. Select this repository and the `ehi-paper/` folder
3. Overleaf will sync bidirectionally with this folder

## Code Repository

The implementation code is available in the parent repository:
- Heat index implementation: `../EHI-Validation/src/heatindex_ek.py`
- Validation notebooks: `../EHI-Validation/notebooks/`
- Visualization scripts: `../EHI-Validation/notebooks/exploratory/`

## Contact

Elif Kilic
University of California, Berkeley
elifkilic@berkeley.edu

## Funding

This research was supported by the ClimateWorks Foundation, GEM Fellowship, and the India Energy and Climate Center.

## License

[To be determined]
