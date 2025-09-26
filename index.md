---
layout: page
title: "Measuring Heat Stress (EHI‑350)"
---

<!-- what changed & why: Added dedicated page for the heat‑stress measurement path to host figures, methodology, and interactive content -->

**Summary.** The EHI‑350 metric extends the Extended Heat Index by incorporating metabolic heat (Qₘ) and solar load (Qₛ). Calculations are performed in Kelvin and later converted to °C for display. Region‑dependent air and vapor resistances follow Lu & Romps.

### Figures

<img src="./assets/ehi350_example.png" alt="Example of EHI‑350 regions" style="width:100%;border-radius:8px" loading="lazy">

### Interactive

<!-- If you have a hosted dashboard or interactive notebook, embed it here using an iframe. Example: -->
<!-- <iframe src="https://your-dashboard.com/embed" title="EHI‑350 interactive demo" width="100%" height="600" loading="lazy" style="border:1px solid #eee;border-radius:12px"></iframe> -->

### Methods (brief)

- Shade tests default to Qₛ = 0; metabolic load defaults to Qₘ = 180 W m⁻² (note if using 350).  
- Salt factor φ<sub>salt</sub> = 0.9.  
- Skin‑flow limit R<sub>smin</sub> derived from V̇<sub>dot_max</sub> = 7.8 L min⁻¹ and A = 1.93 m².  
- Use appropriate air/vapor resistances (Rₐ, Zₐ) based on region and Lu & Romps.  
- Solve air temperature T<sub>a</sub> at p<sub>a₀</sub> = 1600 Pa using Kelvin mathematics.

**Downloads.**  
Place any related PDFs, notebooks, or images in `research/measuring_heat_stress/assets/` and link them here when ready.