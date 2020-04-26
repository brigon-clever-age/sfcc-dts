import axios from "axios";
import cheerio from "cheerio";
import cliProgress from 'cli-progress';


const progress = new cliProgress.SingleBar({}, cliProgress.Presets.rect);
const api = {};

const propKey = (item, key) => {
  let count = 0;
 
  while (item[key]) {
    key += count++;
  }
  return key;
}

const arrayToObj = (array) => {
  const initialValue = {};
  for (let j = 0; j < array.length; j++) {
    const element = array[j];
    initialValue[propKey(initialValue, element.name)] = element;
  }
  return initialValue;
};

(async () => {
  const baseUrl =
    "https://documentation.b2c.commercecloud.salesforce.com/DOC1/topic/com.demandware.dochelp/DWAPI/scriptapi/html/api/";
  let response = await axios.get(baseUrl + "classList.html");
  let $ = cheerio.load(response.data);
  let classLinks = $("a[href^=class_]")
    .map((i, el) => $(el).attr("href"))
    .toArray();

  console.log(`Scraping ${classLinks.length} classes`);
  progress.start(classLinks.length, 0);

  return Promise.all(
    classLinks.map(async (classLink) => {
      try {
        let classPage = await axios.get(baseUrl + classLink);
        let $ = cheerio.load(classPage.data);
        let deprecated = $('.classSumary .parameters .parameterTitle').filter((i, el) => $(el).text().indexOf('Deprecated') >= 0);
        let $class = $("div[id^=class_]");


        if ($class.length > 0 && deprecated.length === 0) {
          let fullClassName = $class.eq(0).attr("id").split("_")[1];
          let className = fullClassName.split('.').slice(-1)[0];
          var packageName = $('.packageName').text().trim();
          var classes = packageName.split('.').reduce((classesInPackage, packageName) => {
            return classesInPackage[packageName] || (classesInPackage[packageName] = {});
          }, api);
          if (!(className in classes)) {
            // console.log('Parsing ' + className);

            classes[className] = {
              fullClassName: fullClassName,
              package: packageName,
              description: $('.classSummaryDetail .description').html().trim(),
              hierarchy: $(".hierarchy a[href]")
                .map((i, el) => ({
                  name: $(el).text().trim(),
                  // link: $(el).attr("href"),
                }))
                .get(),
              constants: arrayToObj($(".section")
                .filter((i, el) => $(el).find(".header").text().trim() === "Constants")
                .find(".summaryItem")
                .map((i, el) => {
                  let description = $(el).find(".description").text();
                  let propertyText = $(el).text().replace(description, '').trim();
                  let parsedPropertyText = /^(\n|\s)*([^\s\t]+)(\n|\t|\s|:)*([^\s\t]+)(\n|\t|\s)*(=(\n|\t|\s)*(("[^"]+")|([^\s\t\n]+)))?/.exec(
                    propertyText
                  );
                  return {
                    name: parsedPropertyText[2].trim(),
                    value: parsedPropertyText[8] ? parsedPropertyText[8].trim() : null,
                    class: {
                      name:
                        $(el).find("a[href] span").text().trim() ||
                        parsedPropertyText[4].trim(),
                      // link: $(el).find("a[href]").attr("href"),
                    },
                    description: description.trim(),
                    deprecated: $(el).find(".dep").length
                  };
                })
                .get()),
              properties: arrayToObj($(".section")
                .filter(
                  (i, el) => $(el).find(".header").text().trim() === "Properties"
                )
                .find(".summaryItem")
                .map((i, el) => {

                  let propertyEL = $(el);
                  if (propertyEL.find('.description')) {
                    propertyEL = propertyEL.clone();
                    propertyEL.find('.description').remove();
                  }
                  let propertyText = propertyEL.text().trim();

                  let parsedPropertyText = /^(\n|\s)*(static)?(\n|\s)*([^\s\t]+)(\n|\t|\s|:)*([^\s\t]+)/.exec(
                    propertyText
                  );
                  return {
                    name: parsedPropertyText[4].trim(),
                    class: {
                      name:
                        $(el).find("a[href] span").text().trim() ||
                        parsedPropertyText[6].trim(),
                      // link: $(el).find("a[href]").attr("href"),
                    },
                    static: !!parsedPropertyText[2],
                    readOnly: propertyText.indexOf("Read Only") > 0,
                    description: $(el).find(".description").text().trim(),
                    deprecated: $(el).find(".dep").length
                  };
                })
                .get()),
              constructors: arrayToObj($(".section")
                .filter(
                  (i, el) =>
                    $(el)
                      .find(".header")
                      .text()
                      .indexOf("Constructor Summary") >= 0
                    && $(el).find('.summaryItem').eq(0).text().indexOf('This class does not have a constructor') < 0
                )
                .find(".summaryItem")
                .map((i, el) => {
                  let propertyText = $(el).text().trim();
                  let parsedPropertyText = /^(\n|\s)*(public)?(\n|\s)*([^\s\t\(]+)\(([^\)]*)\)/.exec(
                    propertyText
                  );
                  return {
                    name: $(el).find(".emphasis").text().trim(),
                    args: parsedPropertyText[5].split(",").filter(arg => arg && arg.trim().length).map((arg) => {
                      let argTouple = arg.split(":");
                      let argType = argTouple[1].trim().split('...');
                      return {
                        name: argTouple[0].trim(),
                        class: {
                          name: argType[0].trim(),
                        },
                        multiple: argType.length > 1
                      };
                    }),
                    description: $(el).find(".description").text().trim(),
                    deprecated: $(el).find(".dep").length
                  };
                })
                .get()),
              methods: arrayToObj($(".section")
                .filter(
                  (i, el) =>
                    $(el).find(".header").text().indexOf("Method Detail") >= 0
                )
                .find(".detailItem")
                .map((i, el) => {

                  let detailSignature = $(el).find('.detailSignature').text().trim();
                  let parsedPropertyText = /^(?:\n|\s)*(static)?(?:\n|\s)*([^\s\t]+)\(([^\)]*)\)(?:\n|\t|\s|:)*([^\s\t]+)/.exec(
                    detailSignature
                  );

                  let staticprefix = parsedPropertyText[1];
                  let params = parsedPropertyText[3];
                  let returnValue = parsedPropertyText[4];
                  let returnDesc = $(el).find(".parameters").filter(
                    (i, el) =>
                      $(el).find(".parameterTitle").text().indexOf("Returns:") >= 0
                  ).find('.parameterDesc').text().trim();

                  let paramsDoc = $(el).find(".parameters").filter((i, el) => $(el).find(".parameterTitle").text().indexOf("Parameters:") >= 0).find('.parameterDetail');

                  return {
                    name: $(el).find(".detailName").text().trim(),
                    args: params.split(",").filter(arg => arg && arg.trim().length).map((arg) => {
                      let argTouple = arg.split(":");
                      let argType = argTouple[1].trim().split('...');
                      let argName = argTouple[0].trim();
                      return {
                        name: argName,
                        description: paramsDoc.filter((i, el) => $(el).find(".parameterName").text().trim() == argName).find('.parameterDesc').text().trim(),
                        class: {
                          name: argType[0].trim(),
                        },
                        multiple: argType.length > 1
                      };
                    }),
                    static: staticprefix && staticprefix.indexOf('static') == 0,
                    class: {
                      name: returnValue,
                      description: returnDesc
                    },
                    description: $(el).find(".description").text().trim(),
                    deprecated: !!$(el).find(".dep").length
                  };
                })
                .get()),
            };
          }
        }
      } catch (e) {
        console.error(e);
      }
      progress.increment();
    })
  );
})().then(() => {
  progress.stop();
  const fs = require('fs');
  const path = require('path');

  const sort = (obj) => {
    if (obj.fullClassName) return obj;
    return Object.keys(obj).sort().reduce(function (sortedObj, key) {
      sortedObj[key] = sort(obj[key]);
      return sortedObj;
    }, {});
  };
  const apiSorted = sort(api);
  const collectClasses = (obj, mapping) => {
    if (obj.fullClassName) {
      if (!obj.fullClassName.startsWith('TopLevel.')) {
        mapping[obj.fullClassName.split('.').pop()] = obj.fullClassName;
      }
    } else {
      Object.keys(obj).forEach((key) => collectClasses(obj[key], mapping));
    }
    return mapping;
  }
  const apiMapping = collectClasses(apiSorted, {});

  const collectInterfaces = (obj, interfaces) => {
    if (obj.hierarchy) {
      obj.hierarchy.forEach(el => {
        if (!interfaces.includes(el.name)) {
          interfaces.push(el.name);
        }
      });
    } else {
      Object.keys(obj).forEach((key) => collectInterfaces(obj[key], interfaces));
    }
    return interfaces;
  }
  const apiInterfaces = collectInterfaces(apiSorted, []);

  console.log('Writing files')
  fs.writeFileSync(path.join(process.cwd(), './api/sfcc-api.json'), JSON.stringify({
    api: apiSorted,
    mapping: apiMapping,
    interfaces: apiInterfaces
  }, null, 2));
});
