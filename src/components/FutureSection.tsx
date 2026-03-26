"use client";
import React from 'react';

const roadmapItems = [
  {
    title: "The Foundation Course",
    status: "In Development",
    statusColor: "bg-primary/10 text-primary border border-primary/20",
    description: "Many Christians feel stuck between salvation and heaven. This 4-level course provides the roadmap to move you from a foundational understanding of the Gospel to a lifestyle of supernatural power and practical transformation.",
    icon: "menu_book",
    iconBg: "bg-primary/10 text-primary",
    active: true
  },
  {
    title: "Advanced Courses",
    status: "Next Up",
    statusColor: "bg-primary/10 text-primary border border-primary/20",
    description: "Deep-dive structured learning modules covering theology, leadership, and specific biblical topics. We are exploring partnerships with seminaries for content.",
    icon: "school",
    iconBg: "bg-primary/10 text-primary",
    active: true
  },
  {
    title: "Bible Integration",
    status: "Planned",
    statusColor: "bg-background-dark/10 text-background-dark border border-background-dark/10",
    description: "A seamless scripture reading experience directly in the app. Includes cross-references, highlighting, and the ability to add personal notes to verses.",
    icon: "auto_stories",
    iconBg: "bg-background-dark/10 text-background-dark",
    active: false
  },
  {
    title: "Testimonies Section",
    status: "Future Concept",
    statusColor: "bg-secondary/10 text-secondary border border-secondary/20",
    description: "A community-driven section to share personal stories of grace. This feature aims to encourage the community by reading inspiring testimonies from around the world.",
    icon: "forum",
    iconBg: "bg-secondary/10 text-secondary",
    active: false
  },
  {
    title: "More to be announced",
    status: "TBA",
    statusColor: "bg-secondary/10 text-secondary border border-secondary/20",
    description: "We are constantly listening to the needs of the global church and will be announcing more features soon.",
    icon: "more_horiz",
    iconBg: "bg-secondary/10 text-secondary",
    active: false
  }
];

const FutureSection: React.FC = () => {
  return (
    <section id="roadmap" className="bg-[#F8F9FA] py-24 sm:py-32 border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-background-dark mb-4 tracking-tight">
            Product Roadmap
          </h2>
          <p className="text-lg text-gray-600 font-medium max-w-3xl mx-auto">
            This is just the beginning. Our development roadmap is dedicated to equipping the saints with every tool needed for maturity—from scripture integration to global prayer networks.
          </p>
        </div>

        {/* Timeline Container */}
        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-4 sm:left-6 top-6 bottom-6 w-0.5 bg-primary/20"></div>

          <div className="flex flex-col gap-12">
            {roadmapItems.map((item, index) => (
              <div key={index} className="relative pl-14 sm:pl-20">
                {/* Timeline Dot */}
                <div 
                  className={`absolute left-[10px] sm:left-[18px] top-8 w-4 h-4 rounded-full border-[3px] border-white shadow-sm z-10 
                  ${item.active ? 'bg-primary ring-4 ring-primary/15' : 'bg-gray-300'}`}
                ></div>

                {/* Card */}
                <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] border border-gray-100 hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                  <div className="flex flex-col sm:flex-row gap-6">
                    {/* Icon Box */}
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${item.iconBg}`}>
                      <span className="material-symbols-outlined text-3xl">{item.icon}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
                        <h3 className="text-xl font-bold text-gray-900 tracking-tight">{item.title}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${item.statusColor}`}>
                          {item.status}
                        </span>
                      </div>
                      
                      <p className="text-gray-500 leading-relaxed text-[15px]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default FutureSection;