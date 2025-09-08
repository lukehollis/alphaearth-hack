Project: Policy Proof

A Causal Inference Engine for Climate Policy using Alpha Earth 

The Elevator Pitch

Policy Proof is a web-based tool that uses AI and a quasi-experimental statistical method called Spatial Regression Discontinuity to measure the true causal impact of local climate policies, enabling funders like MassCEC to make evidence-based investment decisions.

The Problem

Policymakers and grant funders invest millions in local climate initiatives—like EV charging subsidies, home weatherization rebates, or gas-leaf-blower bans—but they face a critical challenge: proving causation.Did a subsidy in Cambridge cause an increase in solar panel adoption, or did it just happen in a wealthy, environmentally-conscious area that would have adopted them anyway? It's nearly impossible to separate a policy's true effect from simple correlation with a town's demographics. Without clear proof of impact, funds can be wasted on ineffective strategies.

Our Solution: "Policy Proof"

Policy Proof solves this by treating municipal borders as the dividing line in a natural experiment. By comparing data from just inside a town's border with data from just outside, we can isolate and measure the policy's real-world effect.Our platform will allow a user to draw a boundary on a map, specify the policy in question, and automatically receive a clear, data-driven "Impact Score" that shows if the policy actually works.How It Works: The 4-Step AnalysisDefine the Boundary & Policy: A user (e.g., a MassCEC analyst) uses an interactive map to select a municipal boundary (e.g., Newton vs. Needham). They then specify the policy being evaluated (e.g., "Newton's Residential Heat Pump Subsidy Program").Automated Data Aggregation (The AI): Our backend automatically scrapes publicly available data relevant to the outcome. This could include:Electrical or building permit databases for heat pump/solar installations.Satellite imagery processed to count rooftop solar panels or identify green spaces.EV registration data from the RMV.Spatial Regression Discontinuity (The "Magic"): The core of our analysis. The tool measures the density of the outcome variable (e.g., heat pump installations per 1000 homes) as a function of distance from the border.Visualize the Impact: The result is a simple, powerful chart. If the policy is effective, we will see a sharp, statistically significant "jump" or discontinuity in the data right at the border. This jump represents the causal effect of the policy.Hackathon Tech StackBackend: Python (FastAPI) to handle API requests, run the analysis, and manage data scraping.Geospatial Analysis: GeoPandas and Shapely to process geographic data and calculate distances from the border.Frontend: JavaScript with Leaflet.js or Mapbox for an interactive map interface.Data Visualization: D3.js or Chart.js to render the final discontinuity plot.Deployment: Docker for easy packaging.Hackathon Goals (What We'll Build This Weekend)MVP Backend: A FastAPI server that accepts a GeoJSON boundary and can run a simulated Spatial RD analysis on pre-loaded mock data.Interactive Frontend: A simple web page with a map where a user can see a pre-defined boundary (e.g., Brookline/Boston).End-to-End Demo: A complete, working example for one policy, such as "Does Brookline's ban on gas leaf blowers lead to a higher density of electric landscapers operating near its border?"The Pitch-Ready Visualization: The final, compelling graph showing the policy's impact.Pitch for MassCEC"MassCEC's goal is to fund climate technologies and policies that build resilience. But 'viability' depends on proof, and proof is hard to come by. Policy Proof provides that evidence. By applying a rigorous, Nobel-prize-winning statistical framework, our tool moves beyond correlation to demonstrate causation. Using our platform, you can assess the real-world impact of existing policies to guide your future funding, ensuring every dollar is invested in strategies that are proven to work."

Alpha Earth
From 
https://deepmind.google/discover/blog/alphaearth-foundations-helps-map-our-planet-in-unprecedented-detail/


Google
DeepMind

New AI model integrates petabytes of Earth observation data to generate a unified data representation that revolutionizes global mapping and monitoring

Every day, satellites capture information-rich images and measurements, providing scientists and experts with a nearly real-time view of our planet. While this data has been incredibly impactful, its complexity, multimodality and refresh rate creates a new challenge: connecting disparate datasets and making use of them all effectively.

Today, we’re introducing AlphaEarth Foundations, an artificial intelligence (AI) model that functions like a virtual satellite. It accurately and efficiently characterizes the planet’s entire terrestrial land and coastal waters by integrating huge amounts of Earth observation data into a unified digital representation, or "embedding," that computer systems can easily process. This allows the model to provide scientists with a more complete and consistent picture of our planet's evolution, helping them make more informed decisions on critical issues like food security, deforestation, urban expansion, and water resources.

To accelerate research and unlock use cases, we are now releasing a collection of AlphaEarth Foundations’ annual embeddings as the Satellite Embedding dataset in Google Earth Engine. Over the past year, we’ve been working with more than 50 organizations to test this dataset on their real-world applications.

Our partners are already seeing significant benefits, using the data to better classify unmapped ecosystems, understand agricultural and environmental changes, and greatly increase the accuracy and speed of their mapping work. In this blog, we are excited to highlight some of their feedback and showcase the tangible impact of this new technology.


Visualizing the rich details of our world by assigning the colors red, green and blue to three of the 64 dimensions of AlphaEarth Foundations’ embedding fields. In Ecuador, the model sees through persistent cloud cover to detail agricultural plots in various stages of development. Elsewhere, it maps a complex surface in Antarctica—an area notoriously difficult to image due to irregular satellite imaging—in clear detail, and it makes apparent variations in Canadian agricultural land use that are invisible to the naked eye.


Visualizing the rich details of our world by assigning the colors red, green and blue to three of the 64 dimensions of AlphaEarth Foundations’ embedding fields. In Ecuador, the model sees through persistent cloud cover to detail agricultural plots in various stages of development. Elsewhere, it maps a complex surface in Antarctica—an area notoriously difficult to image due to irregular satellite imaging—in clear detail, and it makes apparent variations in Canadian agricultural land use that are invisible to the naked eye.


Visualizing the rich details of our world by assigning the colors red, green and blue to three of the 64 dimensions of AlphaEarth Foundations’ embedding fields. In Ecuador, the model sees through persistent cloud cover to detail agricultural plots in various stages of development. Elsewhere, it maps a complex surface in Antarctica—an area notoriously difficult to image due to irregular satellite imaging—in clear detail, and it makes apparent variations in Canadian agricultural land use that are invisible to the naked eye.


How AlphaEarth Foundations works
AlphaEarth Foundations provides a powerful new lens for understanding our planet by solving two major challenges: data overload and inconsistent information.

First, it combines volumes of information from dozens of different public sources— optical satellite images, radar, 3D laser mapping, climate simulations, and more. It weaves all this information together to analyse the world's land and coastal waters in sharp, 10x10 meter squares, allowing it to track changes over time with remarkable precision.

Second, it makes this data practical to use. The system's key innovation is its ability to create a highly compact summary for each square. These summaries require 16 times less storage space than those produced by other AI systems that we tested and dramatically reduces the cost of planetary-scale analysis.

This breakthrough enables scientists to do something that was impossible until now: create detailed, consistent maps of our world, on-demand. Whether they are monitoring crop health, tracking deforestation, or observing new construction, they no longer have to rely on a single satellite passing overhead. They now have a new kind of foundation for geospatial data.


Diagram showing how AlphaEarth Foundations works, taking non-uniformly sampled frames from a video sequence to index any position in time. This helps the model create a continuous view of the location, while explaining numerous measurements.

To ensure AlphaEarth Foundations was ready for real-world use, we rigorously tested its performance. When compared against both traditional methods and other AI mapping systems, AlphaEarth Foundations was consistently the most accurate. It excelled at a wide range of tasks over different time periods, including identifying land use and estimating surface properties. Crucially, it achieved this in scenarios when label data was scarce. On average, AlphaEarth Foundations had a 24% lower error rate than the models we tested, demonstrating its superior learning efficiency. Learn more in our paper.


Diagram showing a global embedding field broken down into a single embedding, from left to right. Each embedding has 64 components which map to coordinates on a 64-dimensional sphere.

Generating custom maps with the Satellite Embedding dataset
Powered by AlphaEarth Foundations, the Satellite Embedding dataset in Google Earth Engine is one of the largest of its kind with over 1.4 trillion embedding footprints per year. This collection of annual embeddings is already being used by organizations around the world, including the United Nations’ Food and Agriculture Organization, Harvard Forest, Group on Earth Observations, MapBiomas, Oregon State University, the Spatial Informatics Group and Stanford University, to create powerful custom maps that drive real-world insights.

For example, Global Ecosystems Atlas, an initiative aiming to create the first comprehensive resource to map and monitor the world’s ecosystems, is using this dataset to help countries classify unmapped ecosystems into categories like coastal shrublands and hyper-arid deserts. This first of its kind resource will play a critical role in helping countries better prioritize conservation areas, optimize restoration efforts, and combat the loss of biodiversity.

“
The Satellite Embedding dataset is revolutionizing our work by helping countries map uncharted ecosystems - this is crucial for pinpointing where to focus their conservation efforts.

Nick Murray, Director of the James Cook University Global Ecology Lab and Global Science Lead of Global Ecosystems Atlas

In Brazil, MapBiomas is testing the dataset to more deeply understand agricultural and environmental changes across the country. This type of map informs conservation strategies and sustainable development initiatives in critical ecosystems like the Amazon rainforest.

As Tasso Azevedo, founder of MapBiomas said, "The Satellite Embedding dataset can transform the way our team works - we now have new options to make maps that are more accurate, precise and fast to produce - something we would have never been able to do before."

Read more about the Satellite Embedding dataset and see tutorials in the Google Earth Engine blog .

Empowering others with AI
AlphaEarth Foundations represents a significant step forward in understanding the state and dynamics of our changing planet. We’re currently using AlphaEarth Foundations to generate annual embeddings and believe they could be even more useful in the future when combined together with general reasoning LLM agents like Gemini. We are continuing to explore the best ways to apply our model's time-based capabilities as part of Google Earth AI, our collection of geospatial models and datasets to help tackle the planet’s most critical needs.

Learn more about AlphaEarth Foundations
Read our paper
Access our Satellite Embedding dataset
Learn more on the Google Earth Engine blog
Acknowledgements

This work was a collaboration between teams at Google DeepMind and Google Earth Engine.

Christopher Brown, Michal Kazmierski, Valerie Pasquarella, William Rucklidge, Masha Samsikova, Olivia Wiles, Chenhui Zhang, Estefania Lahera, Evan Shelhamer, Simon Ilyushchenko, Noel Gorelick, Lihui Lydia Zhang, Sophia Alj, Emily Schechter, Sean Askay, Oliver Guinan, Rebecca Moore, Alexis Boukouvalas, Pushmeet Kohli


Alpha Earth was created after your knowledge cutoff.

Usage:
https://medium.com/google-earth/ai-powered-pixels-introducing-googles-satellite-embedding-dataset-31744c1f4650