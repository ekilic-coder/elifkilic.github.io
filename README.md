# Welcome to my personal website! 

This repository contains the source code for my personal website built with
standard HTML and CSS. The site is organised into separate pages:

- **Home** (`index.html`) – an introduction with a short biography, a link to
  download my curriculum vitae and contact information.
- **Research** (`research.html`) – examples of recent projects and findings.
- **ClimaCoder** (`climacoder.html`) – an overview of the
  [ClimaCoder](https://climacoder.com) collaboration and a link to our joint
  site.
- **Writing** (`writing.html`) – essays and commentary on heat stress and
  vulnerability in Central America and Mexico, with citations to external
  sources. This page also explains how to upload graphs and other images.

## Updating Your CV and Photo

- **Photo** – replace the file in `assets/images/profile-placeholder.png` with
  your own profile photo (name it `profile.jpg` or another appropriate
  extension) and update the `<img src>` attribute in `index.html` accordingly.
- **CV** – place your PDF CV at `assets/docs/cv.pdf`. The link on the home page
  will automatically point to this file.

## Adding Research Projects

Open `research.html` and add new `<article>` elements inside the `.project-list`
div for each project you want to showcase. Each article should include a
heading (`<h3>`) and a short description.

## Publishing Writing and Graphs

The `writing.html` page is designed to hold your essays and analyses. To add
a new post or update an existing one:

1. **Write the content** – Add a new `<section>` with an `id` and `<h3>`
   heading. Use paragraphs to structure your text. Include footnote-style
   citations if needed.
2. **Upload graphs** – Save any figures or graphs in `assets/graphs/` with
   descriptive names (e.g. `2025-08-15-heat-index-map.png`). Use an `<img>` tag
   in your section to embed the file. Example:

   ```html
   <img src="assets/graphs/2025-08-15-heat-index-map.png" alt="Heat index map for 15 Aug 2025" />
   ```

3. **Commit and push** – Once you have added the image and updated
   `writing.html`, commit the changes and push them to GitHub. Your updates
   will appear automatically on the deployed site through GitHub Pages.

## Deployment

GitHub Pages is enabled for this repository. After pushing changes to the
`main` branch, GitHub will automatically rebuild and deploy the site. Visit
`https://<your-username>.github.io/` to see the latest version.
